import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AuthSessionResultSchema, type AuthSessionResult } from '@lyntar/contracts';

export interface CredentialStore {
  get(): Promise<AuthSessionResult | null>;
  set(session: AuthSessionResult): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  private session: AuthSessionResult | null = null;

  async get(): Promise<AuthSessionResult | null> {
    return this.session;
  }

  async set(session: AuthSessionResult): Promise<void> {
    this.session = session;
  }

  async clear(): Promise<void> {
    this.session = null;
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
    return join(this.options.userDataPath, 'lyntar-session.bin');
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
}
