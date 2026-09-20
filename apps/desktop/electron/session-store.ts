import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentSession, SessionCheckpoint, SessionStore } from '@lyntar/agent-core';

interface SessionFile {
  sessions: AgentSession[];
  checkpoints: SessionCheckpoint[];
}

function emptyFile(): SessionFile {
  return { sessions: [], checkpoints: [] };
}

function isSessionFile(value: unknown): value is SessionFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { sessions?: unknown }).sessions) &&
    Array.isArray((value as { checkpoints?: unknown }).checkpoints)
  );
}

/**
 * Desktop-only persistence for compact agent session/checkpoint metadata.
 * Raw prompts, source files, tokens, and model scratchpad content are not
 * persisted here; the agent core stores bounded structured state only.
 */
export class FileSessionStore implements SessionStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly userDataPath: string) {}

  private get path(): string {
    return join(this.userDataPath, 'astra-agent-sessions.json');
  }

  private async load(): Promise<SessionFile> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isSessionFile(parsed)) throw new Error('Astra session store is invalid');
      return parsed;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return emptyFile();
      throw error;
    }
  }

  private async save(file: SessionFile): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.path);
  }

  private async update<T>(operation: (file: SessionFile) => Promise<T> | T): Promise<T> {
    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const file = await this.load();
      const result = await operation(file);
      await this.save(file);
      return result;
    } finally {
      release();
    }
  }

  async createSession(
    session: Omit<AgentSession, 'createdAt' | 'updatedAt'>,
  ): Promise<AgentSession> {
    return this.update((file) => {
      if (file.sessions.some((candidate) => candidate.sessionId === session.sessionId))
        throw new Error(`Agent session already exists: ${session.sessionId}`);
      const now = new Date().toISOString();
      const created = { ...session, createdAt: now, updatedAt: now };
      file.sessions.push(created);
      return { ...created };
    });
  }

  async getSession(sessionId: string): Promise<AgentSession | undefined> {
    const file = await this.load();
    const session = file.sessions.find((candidate) => candidate.sessionId === sessionId);
    return session
      ? { ...session, structuredState: session.structuredState && { ...session.structuredState } }
      : undefined;
  }

  async updateSession(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession> {
    return this.update((file) => {
      const index = file.sessions.findIndex((candidate) => candidate.sessionId === sessionId);
      if (index < 0) throw new Error(`Agent session not found: ${sessionId}`);
      const updated = { ...file.sessions[index]!, ...patch, updatedAt: new Date().toISOString() };
      file.sessions[index] = updated;
      return { ...updated };
    });
  }

  async saveCheckpoint(checkpoint: SessionCheckpoint): Promise<SessionCheckpoint> {
    return this.update((file) => {
      file.checkpoints.push(checkpoint);
      if (file.checkpoints.length > 1_000)
        file.checkpoints.splice(0, file.checkpoints.length - 1_000);
      return { ...checkpoint };
    });
  }

  async getCheckpoint(checkpointId: string): Promise<SessionCheckpoint | undefined> {
    const file = await this.load();
    const checkpoint = file.checkpoints.find(
      (candidate) => candidate.checkpointId === checkpointId,
    );
    return checkpoint ? { ...checkpoint } : undefined;
  }

  async getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | undefined> {
    const file = await this.load();
    const checkpoints = file.checkpoints.filter((candidate) => candidate.sessionId === sessionId);
    const checkpoint = checkpoints.at(-1);
    return checkpoint ? { ...checkpoint } : undefined;
  }

  async listSessions(userId: string): Promise<AgentSession[]> {
    const file = await this.load();
    return file.sessions
      .filter((session) => session.userId === userId)
      .map((session) => ({ ...session }));
  }
}
