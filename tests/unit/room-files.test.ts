import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  RemoteAccessService,
  buildRoomFileImportManifest,
  extractRoomArchive,
  inspectRoomArchive,
  normalizeRoomFileUpload,
} from '@astra/remote-protocol';

const TEAM = {
  id: 'TEAM',
  seats: 5,
  monthlyCredits: '6000',
  pooledCredits: true,
  crossPersonRooms: true,
};

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; content: Buffer; compressed?: boolean }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = entry.compressed ? deflateRawSync(entry.content) : entry.content;
    const method = entry.compressed ? 8 : 0;
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(entry.content), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc32(entry.content), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(entry.content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(0x00000000, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function roomFixture() {
  const now = new Date('2026-09-21T00:00:00.000Z');
  const access = new RemoteAccessService({ now: () => now });
  const host = access.registerDevice({
    userId: 'alice',
    label: 'Alice host',
    platform: 'win32',
    architecture: 'x64',
    publicKeyPem: 'alice-room-file-key',
  });
  const organization = access.createOrganization({
    ownerUserId: 'alice',
    displayName: 'Astra Team',
    plan: TEAM,
  });
  const room = access.createRoom({
    actorUserId: 'alice',
    organizationId: organization.id,
    hostDeviceId: host.id,
    name: 'Website',
    workspaceRootRelative: 'projects/website',
  });
  access.heartbeat('alice', host.id);
  return { access, host, organization, room };
}

describe('Room Files and project import safety', () => {
  it('normalizes reference uploads and keeps content scoped to the Room', () => {
    const { access, room } = roomFixture();
    const content = Buffer.from('use this as a design reference', 'utf8');
    const record = access.uploadRoomFile({
      actorUserId: 'alice',
      roomId: room.id,
      originalName: 'design-notes.txt',
      contentType: 'text/plain',
      content,
      intent: 'REFERENCE',
    });

    expect(record).toMatchObject({
      roomId: room.id,
      originalName: 'design-notes.txt',
      safeName: 'design-notes.txt',
      intent: 'REFERENCE',
      securityState: 'SAFE',
      sizeBytes: content.length,
    });
    expect(
      access.getRoomFile({ actorUserId: 'alice', roomId: room.id, fileId: record.id }).content,
    ).toEqual(content);
    expect(access.listRoomFiles('alice', room.id)).toHaveLength(1);
  });

  it('rejects unsafe names, executable content, and archive traversal', () => {
    expect(() =>
      normalizeRoomFileUpload({
        originalName: '../secrets.txt',
        contentType: 'text/plain',
        content: Buffer.from('secret'),
        intent: 'REFERENCE',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROOM_FILE_INVALID' }));
    expect(() =>
      normalizeRoomFileUpload({
        originalName: 'payload.exe',
        contentType: 'application/octet-stream',
        content: Buffer.from([0x4d, 0x5a, 0x00]),
        intent: 'ADD_TO_PROJECT',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROOM_FILE_REJECTED' }));

    const traversal = zip([{ name: '../escape.txt', content: Buffer.from('blocked') }]);
    expect(() => inspectRoomArchive(traversal)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_INVALID' }),
    );
  });

  it('inspects and extracts a safe archive, then produces a conflict-aware manifest', () => {
    const archive = zip([
      { name: 'src/index.ts', content: Buffer.from('export const answer = 42;'), compressed: true },
      { name: 'README.md', content: Buffer.from('# Fixture') },
    ]);
    expect(inspectRoomArchive(archive).map((entry) => entry.path)).toEqual([
      'src/index.ts',
      'README.md',
    ]);
    expect(extractRoomArchive(archive).map((entry) => entry.content.toString('utf8'))).toEqual([
      'export const answer = 42;',
      '# Fixture',
    ]);
    const manifest = buildRoomFileImportManifest({
      fileId: 'file-1',
      safeName: 'fixture.zip',
      contentType: 'application/zip',
      content: archive,
      destinationRelative: 'vendor/fixture',
      existingPaths: ['vendor/fixture/README.md'],
    });
    expect(manifest).toMatchObject({ createCount: 1, overwriteCount: 1, rejectedCount: 0 });
    expect(manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'vendor/fixture/src/index.ts', action: 'CREATE' }),
        expect.objectContaining({ path: 'vendor/fixture/README.md', action: 'OVERWRITE' }),
      ]),
    );
  });

  it('requires a preview and approval before the host can complete an import', () => {
    const { access, host, room } = roomFixture();
    const record = access.uploadRoomFile({
      actorUserId: 'alice',
      roomId: room.id,
      originalName: 'logo.svg',
      contentType: 'image/svg+xml',
      content: Buffer.from('<svg />'),
      intent: 'ADD_TO_PROJECT',
    });
    const proposal = access.createRoomFileImport({
      actorUserId: 'alice',
      roomId: room.id,
      fileId: record.id,
      destinationRelative: 'public/assets',
    });
    expect(proposal.status).toBe('PREVIEW');
    expect(proposal.manifest.entries[0]).toMatchObject({
      path: 'public/assets/logo.svg',
      action: 'CREATE',
    });
    expect(() =>
      access.completeRoomFileImport({
        actorUserId: 'alice',
        roomId: room.id,
        importId: proposal.id,
        hostDeviceId: host.id,
        writtenPaths: ['public/assets/logo.svg'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROOM_FILE_STATE_INVALID' }));
    expect(
      access.approveRoomFileImport({ actorUserId: 'alice', roomId: room.id, importId: proposal.id })
        .status,
    ).toBe('APPROVED');
    expect(
      access.completeRoomFileImport({
        actorUserId: 'alice',
        roomId: room.id,
        importId: proposal.id,
        hostDeviceId: host.id,
        writtenPaths: ['public/assets/logo.svg'],
      }).status,
    ).toBe('IMPORTED');
  });

  it('requires destructive approval for overwrites and supports explicit host handoff', () => {
    const { access, room } = roomFixture();
    const bobDevice = access.registerDevice({
      userId: 'bob',
      label: 'Bob host',
      platform: 'win32',
      architecture: 'x64',
      publicKeyPem: 'bob-room-file-key',
    });
    const invitation = access.inviteMember({
      actorUserId: 'alice',
      roomId: room.id,
      email: 'bob@example.test',
      idempotencyKey: 'room-files-bob',
    });
    access.redeemInvitation({
      userId: 'bob',
      email: 'bob@example.test',
      token: invitation.token ?? '',
    });
    const file = access.uploadRoomFile({
      actorUserId: 'alice',
      roomId: room.id,
      originalName: 'config.json',
      contentType: 'application/json',
      content: Buffer.from('{}'),
      intent: 'ADD_TO_PROJECT',
    });
    const overwrite = access.createRoomFileImport({
      actorUserId: 'bob',
      roomId: room.id,
      fileId: file.id,
      destinationRelative: 'config',
      existingPaths: ['config/config.json'],
    });
    expect(() =>
      access.approveRoomFileImport({ actorUserId: 'bob', roomId: room.id, importId: overwrite.id }),
    ).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    expect(
      access.approveRoomFileImport({
        actorUserId: 'alice',
        roomId: room.id,
        importId: overwrite.id,
      }).status,
    ).toBe('APPROVED');

    access.heartbeat('bob', bobDevice.id);
    const handedOff = access.handoffRoom({
      actorUserId: 'alice',
      roomId: room.id,
      hostDeviceId: bobDevice.id,
      workspaceRootRelative: 'projects/website-copy',
      workspaceFingerprint: 'workspace-fingerprint-v2',
    });
    expect(handedOff).toMatchObject({
      id: room.id,
      projectId: room.projectId,
      hostDeviceId: bobDevice.id,
      hostUserId: 'bob',
      workspaceRootRelative: 'projects/website-copy',
      workspaceFingerprint: 'workspace-fingerprint-v2',
      hostBindingVersion: 2,
      hostAvailability: 'ONLINE',
    });
  });

  it('assigns deterministic security severity and redacts sensitive evidence', () => {
    const { access, organization, room } = roomFixture();
    const event = access.recordSecurityEvent({
      organizationId: organization.id,
      roomId: room.id,
      actorUserId: 'alice',
      projectId: room.projectId,
      eventType: 'PATH_ESCAPE_ATTEMPT',
      requestedAction: 'files.read',
      requestedResource: 'C:\\Users\\alice\\.ssh',
      decision: 'BLOCKED',
      outcome: 'outside project root',
      evidence: { attemptedPath: 'C:\\Users\\alice\\.ssh', token: 'do-not-store-this' },
    });
    expect(event.severity).toBe('HIGH');
    expect(event.evidence).toMatchObject({ token: '[REDACTED]' });
    expect(access.listSecurityEvents('alice', room.id)).toEqual([
      expect.objectContaining({ id: event.id }),
    ]);
  });
});
