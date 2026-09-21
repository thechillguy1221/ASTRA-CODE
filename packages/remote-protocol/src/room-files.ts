import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const ROOM_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const ROOM_ARCHIVE_MAX_ENTRIES = 1_000;
export const ROOM_ARCHIVE_MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
export const ROOM_ARCHIVE_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ROOM_ARCHIVE_MAX_COMPRESSION_RATIO = 10_000;

export type RoomFileIntent = 'REFERENCE' | 'ADD_TO_PROJECT';
export type RoomFileSecurityState = 'UPLOADED' | 'VALIDATING' | 'SAFE' | 'REJECTED' | 'DELETED';
export type RoomFileImportStatus = 'PREVIEW' | 'APPROVED' | 'REJECTED' | 'IMPORTED' | 'FAILED';
export type RoomFileImportAction = 'CREATE' | 'OVERWRITE' | 'REJECTED';

export interface RoomFileRecord {
  id: string;
  organizationId: string;
  roomId: string;
  uploaderUserId: string;
  originalName: string;
  safeName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  intent: RoomFileIntent;
  securityState: RoomFileSecurityState;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RoomFileManifestEntry {
  path: string;
  sizeBytes: number;
  checksumSha256: string;
  action: RoomFileImportAction;
  reason?: string;
}

export interface RoomFileImportManifest {
  sourceFileId: string;
  destinationRelative: string;
  entries: RoomFileManifestEntry[];
  createCount: number;
  overwriteCount: number;
  rejectedCount: number;
  totalBytes: number;
}

export interface RoomFileImportProposal {
  id: string;
  organizationId: string;
  roomId: string;
  fileId: string;
  requestedBy: string;
  destinationRelative: string;
  status: RoomFileImportStatus;
  manifest: RoomFileImportManifest;
  approvedBy: string | null;
  approvedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomFileArchiveEntry {
  path: string;
  sizeBytes: number;
  compressedBytes: number;
  compressionMethod: number;
  localHeaderOffset: number;
  checksumSha256: string;
}

export class RoomFileError extends Error {
  constructor(
    public readonly code:
      | 'ROOM_FILE_INVALID'
      | 'ROOM_FILE_TOO_LARGE'
      | 'ROOM_FILE_REJECTED'
      | 'ROOM_FILE_NOT_FOUND'
      | 'IMPORT_INVALID'
      | 'IMPORT_CONFLICT'
      | 'ARCHIVE_INVALID'
      | 'ARCHIVE_LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'RoomFileError';
  }
}

function reject(code: ConstructorParameters<typeof RoomFileError>[0], message: string): never {
  throw new RoomFileError(code, message);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code >= 0 && code <= 31) || code === 127;
  });
}

function reservedWindowsSegment(segment: string): boolean {
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(segment);
}

/**
 * Normalizes a project-relative path while retaining a strict Windows-safe
 * representation. This is used for archive entries and import destinations,
 * below the model and below any client supplied path.
 */
export function assertSafeProjectRelativePath(value: string, allowEmpty = false): string {
  const normalized = value.trim().normalize('NFC').replaceAll('\\', '/');
  if (!normalized && allowEmpty) return '';
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.startsWith('?/') ||
    normalized.includes('\0') ||
    normalized.includes('%') ||
    normalized.includes(':') ||
    normalized.includes('$') ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        reservedWindowsSegment(segment),
    )
  )
    reject('IMPORT_INVALID', 'Path is not a safe project-relative path');
  return normalized;
}

export function normalizeRoomFileName(value: string): string {
  const normalized = value.trim().normalize('NFC').replaceAll('\\', '/');
  if (!normalized || normalized.includes('/') || normalized.includes('\0'))
    reject('ROOM_FILE_INVALID', 'Room file name must be a single safe filename');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.endsWith('.') ||
    normalized.endsWith(' ') ||
    hasControlCharacters(normalized) ||
    reservedWindowsSegment(normalized) ||
    normalized.length > 255
  )
    reject('ROOM_FILE_INVALID', 'Room file name is not safe');
  return normalized;
}

function isZip(name: string, contentType: string, content: Buffer): boolean {
  return (
    contentType === 'application/zip' ||
    contentType === 'application/x-zip-compressed' ||
    name.toLowerCase().endsWith('.zip') ||
    content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  );
}

function ensureBounds(content: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > content.length)
    reject('ARCHIVE_INVALID', 'Archive entry points outside the uploaded file');
}

function readUInt32(content: Buffer, offset: number): number {
  ensureBounds(content, offset, 4);
  return content.readUInt32LE(offset);
}

function readUInt16(content: Buffer, offset: number): number {
  ensureBounds(content, offset, 2);
  return content.readUInt16LE(offset);
}

function findEndOfCentralDirectory(content: Buffer): number {
  const start = Math.max(0, content.length - 65_557);
  for (let offset = content.length - 22; offset >= start; offset -= 1) {
    if (readUInt32(content, offset) === 0x06054b50) return offset;
  }
  reject('ARCHIVE_INVALID', 'ZIP end-of-central-directory record is missing');
}

function decodeZipName(content: Buffer, offset: number, length: number, utf8: boolean): string {
  ensureBounds(content, offset, length);
  const value = content.subarray(offset, offset + length).toString(utf8 ? 'utf8' : 'latin1');
  if (!value || value.includes('\0') || hasControlCharacters(value))
    reject('ARCHIVE_INVALID', 'ZIP entry name contains control characters');
  return value;
}

interface ParsedArchiveEntry {
  path: string;
  sizeBytes: number;
  compressedBytes: number;
  compressionMethod: number;
  localHeaderOffset: number;
  crc32: number;
}

function parseArchive(content: Buffer): ParsedArchiveEntry[] {
  const eocd = findEndOfCentralDirectory(content);
  const disk = readUInt16(content, eocd + 4);
  const centralDisk = readUInt16(content, eocd + 6);
  const entriesOnDisk = readUInt16(content, eocd + 8);
  const entryCount = readUInt16(content, eocd + 10);
  const centralBytes = readUInt32(content, eocd + 12);
  const centralOffset = readUInt32(content, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount)
    reject('ARCHIVE_INVALID', 'Multi-disk ZIP archives are not supported');
  if (entryCount > ROOM_ARCHIVE_MAX_ENTRIES)
    reject('ARCHIVE_LIMIT_EXCEEDED', 'ZIP contains too many entries');
  ensureBounds(content, centralOffset, centralBytes);

  const entries: ParsedArchiveEntry[] = [];
  const paths = new Set<string>();
  let offset = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(content, offset) !== 0x02014b50)
      reject('ARCHIVE_INVALID', 'ZIP central directory entry is malformed');
    const flags = readUInt16(content, offset + 8);
    const method = readUInt16(content, offset + 10);
    const crc = readUInt32(content, offset + 16);
    const compressedBytes = readUInt32(content, offset + 20);
    const sizeBytes = readUInt32(content, offset + 24);
    const nameLength = readUInt16(content, offset + 28);
    const extraLength = readUInt16(content, offset + 30);
    const commentLength = readUInt16(content, offset + 32);
    const attributes = readUInt32(content, offset + 38);
    const localHeaderOffset = readUInt32(content, offset + 42);
    const utf8 = (flags & 0x0800) !== 0;
    const name = decodeZipName(content, offset + 46, nameLength, utf8);
    const directory = name.endsWith('/') || ((attributes >>> 16) & 0xf000) === 0xa000;
    const entryLength = 46 + nameLength + extraLength + commentLength;
    ensureBounds(content, offset, entryLength);
    offset += entryLength;
    if (directory) continue;
    if (flags & 0x0001) reject('ARCHIVE_INVALID', 'Encrypted ZIP entries are not supported');
    if (method !== 0 && method !== 8)
      reject('ARCHIVE_INVALID', `ZIP compression method ${method} is not supported`);
    if (sizeBytes > ROOM_ARCHIVE_MAX_FILE_BYTES)
      reject('ARCHIVE_LIMIT_EXCEEDED', 'ZIP entry is too large');
    if (compressedBytes === 0 && sizeBytes > 0)
      reject('ARCHIVE_INVALID', 'ZIP entry has invalid compressed size');
    if (compressedBytes > 0 && sizeBytes / compressedBytes > ROOM_ARCHIVE_MAX_COMPRESSION_RATIO)
      reject('ARCHIVE_LIMIT_EXCEEDED', 'ZIP compression ratio exceeds the safety limit');
    const safePath = assertSafeProjectRelativePath(name);
    const key = safePath.toLocaleLowerCase('en-US');
    if (paths.has(key)) reject('ARCHIVE_INVALID', 'ZIP contains duplicate or colliding paths');
    paths.add(key);
    totalBytes += sizeBytes;
    if (totalBytes > ROOM_ARCHIVE_MAX_EXPANDED_BYTES)
      reject('ARCHIVE_LIMIT_EXCEEDED', 'ZIP expanded size exceeds the safety limit');
    entries.push({
      path: safePath,
      sizeBytes,
      compressedBytes,
      compressionMethod: method,
      localHeaderOffset,
      crc32: crc,
    });
  }
  if (entries.length === 0) reject('ARCHIVE_INVALID', 'ZIP does not contain importable files');
  return entries;
}

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function extractArchiveEntry(content: Buffer, entry: ParsedArchiveEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (readUInt32(content, offset) !== 0x04034b50)
    reject('ARCHIVE_INVALID', 'ZIP local file header is malformed');
  const nameLength = readUInt16(content, offset + 26);
  const extraLength = readUInt16(content, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  ensureBounds(content, dataOffset, entry.compressedBytes);
  const compressed = content.subarray(dataOffset, dataOffset + entry.compressedBytes);
  let extracted: Buffer;
  try {
    extracted =
      entry.compressionMethod === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
  } catch {
    reject('ARCHIVE_INVALID', 'ZIP entry could not be safely decompressed');
  }
  if (extracted.length !== entry.sizeBytes || crc32(extracted) !== entry.crc32)
    reject('ARCHIVE_INVALID', 'ZIP entry checksum or expanded size is invalid');
  return extracted;
}

export function inspectRoomArchive(content: Buffer): RoomFileArchiveEntry[] {
  return parseArchive(content).map((entry) => ({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    compressedBytes: entry.compressedBytes,
    compressionMethod: entry.compressionMethod,
    localHeaderOffset: entry.localHeaderOffset,
    checksumSha256: '',
  }));
}

export function extractRoomArchive(content: Buffer): Array<{ path: string; content: Buffer }> {
  return parseArchive(content).map((entry) => ({
    path: entry.path,
    content: extractArchiveEntry(content, entry),
  }));
}

export function normalizeRoomFileUpload(input: {
  originalName: string;
  contentType: string;
  content: Buffer;
  intent: RoomFileIntent;
}): { safeName: string; contentType: string; sizeBytes: number; checksumSha256: string } {
  if (!Buffer.isBuffer(input.content)) reject('ROOM_FILE_INVALID', 'Room file content is invalid');
  if (input.content.length > ROOM_FILE_MAX_BYTES)
    reject('ROOM_FILE_TOO_LARGE', 'Room file exceeds the maximum allowed size');
  const safeName = normalizeRoomFileName(input.originalName);
  const contentType = input.contentType.trim().toLowerCase();
  if (!contentType || contentType.length > 120)
    reject('ROOM_FILE_INVALID', 'Room file content type is invalid');
  if (
    input.content.subarray(0, 2).equals(Buffer.from([0x4d, 0x5a])) ||
    input.content.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    reject('ROOM_FILE_REJECTED', 'Executable binary content cannot be imported into a Room');
  if (isZip(safeName, contentType, input.content)) parseArchive(input.content);
  return {
    safeName,
    contentType,
    sizeBytes: input.content.length,
    checksumSha256: createHash('sha256').update(input.content).digest('hex'),
  };
}

function joinImportPath(destinationRelative: string, entryPath: string): string {
  const destination = assertSafeProjectRelativePath(destinationRelative, true);
  return assertSafeProjectRelativePath(destination ? `${destination}/${entryPath}` : entryPath);
}

export function buildRoomFileImportManifest(input: {
  fileId: string;
  safeName: string;
  contentType: string;
  content: Buffer;
  destinationRelative: string;
  existingPaths?: readonly string[];
}): RoomFileImportManifest {
  const destinationRelative = assertSafeProjectRelativePath(input.destinationRelative, true);
  const archive = isZip(input.safeName, input.contentType, input.content);
  const files = archive
    ? extractRoomArchive(input.content).map((entry) => ({
        path: entry.path,
        sizeBytes: entry.content.length,
        checksumSha256: createHash('sha256').update(entry.content).digest('hex'),
      }))
    : [
        {
          path: input.safeName,
          sizeBytes: input.content.length,
          checksumSha256: createHash('sha256').update(input.content).digest('hex'),
        },
      ];
  const existing = new Set(
    (input.existingPaths ?? []).map((value) => assertSafeProjectRelativePath(value).toLowerCase()),
  );
  const entries = files.map((file) => {
    try {
      const path = joinImportPath(destinationRelative, file.path);
      const overwrite = existing.has(path.toLowerCase());
      return {
        path,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        action: overwrite ? ('OVERWRITE' as const) : ('CREATE' as const),
      };
    } catch (error) {
      return {
        path: file.path,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        action: 'REJECTED' as const,
        reason: error instanceof Error ? error.message : 'Invalid import path',
      };
    }
  });
  return {
    sourceFileId: input.fileId,
    destinationRelative,
    entries,
    createCount: entries.filter((entry) => entry.action === 'CREATE').length,
    overwriteCount: entries.filter((entry) => entry.action === 'OVERWRITE').length,
    rejectedCount: entries.filter((entry) => entry.action === 'REJECTED').length,
    totalBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
  };
}
