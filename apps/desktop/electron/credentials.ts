import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AuthSessionResultSchema, type AuthSessionResult } from '@astra/contracts';

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface CredentialStore {
  get(): Promise<AuthSessionResult | null>;
  set(session: AuthSessionResult): Promise<void>;
  clear(): Promise<void>;
  getDeviceIdentity(): Promise<DeviceIdentity | null>;
  setDeviceIdentity(identity: DeviceIdentity): Promise<void>;
  clearDeviceIdentity(): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  private session: AuthSessionResult | null = null;
  private deviceIdentity: DeviceIdentity | null = null;

  async get(): Promise<AuthSessionResult | null> {
    return this.session;
  }

  async set(session: AuthSessionResult): Promise<void> {
    this.session = session;
  }

  async clear(): Promise<void> {
    this.session = null;
  }

  async getDeviceIdentity(): Promise<DeviceIdentity | null> {
    return this.deviceIdentity ? { ...this.deviceIdentity } : null;
  }

  async setDeviceIdentity(identity: DeviceIdentity): Promise<void> {
    this.deviceIdentity = { ...identity };
  }

  async clearDeviceIdentity(): Promise<void> {
    this.deviceIdentity = null;
  }
}

export class SecureCredentialStore implements CredentialStore {
  constructor(
    private readonly options: {
      userDataPath: string;
      safeStorage: {
        isEncryptionAvailable(): boolean;
        encryptString(value: string): Buffer;
        decryptString(value: Buffer): string;
      };
    },
  ) {}

  private get path(): string {
    return join(this.options.userDataPath, 'astra-session.bin');
  }

  private get devicePath(): string {
    return join(this.options.userDataPath, 'astra-device.bin');
  }

  async get(): Promise<AuthSessionResult | null> {
    if (!this.options.safeStorage.isEncryptionAvailable())
      throw new Error('Windows secure credential storage is unavailable');
    try {
      const encrypted = await readFile(this.path);
      return AuthSessionResultSchema.parse(
        JSON.parse(this.options.safeStorage.decryptString(encrypted)),
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  }

  async set(session: AuthSessionResult): Promise<void> {
    if (!this.options.safeStorage.isEncryptionAvailable())
      throw new Error('Windows secure credential storage is unavailable');
    await mkdir(dirname(this.path), { recursive: true });
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(session));
    await writeFile(this.path, encrypted, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }

  async getDeviceIdentity(): Promise<DeviceIdentity | null> {
    if (!this.options.safeStorage.isEncryptionAvailable())
      throw new Error('Windows secure credential storage is unavailable');
    try {
      return JSON.parse(
        this.options.safeStorage.decryptString(await readFile(this.devicePath)),
      ) as DeviceIdentity;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  }

  async setDeviceIdentity(identity: DeviceIdentity): Promise<void> {
    if (!this.options.safeStorage.isEncryptionAvailable())
      throw new Error('Windows secure credential storage is unavailable');
    await mkdir(dirname(this.devicePath), { recursive: true });
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(identity));
    await writeFile(this.devicePath, encrypted, { mode: 0o600 });
  }

  async clearDeviceIdentity(): Promise<void> {
    await rm(this.devicePath, { force: true });
  }
}
