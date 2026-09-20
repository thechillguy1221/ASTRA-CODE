import { z } from 'zod';
import type { TaskState } from '@lyntar/contracts';

// ─── Session Status ────────────────────────────────────────────────────────

export const AgentSessionStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CRASHED',
  'CANCELLED',
]);
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>;

// ─── Structured Task State (compact, model-rehydratable) ──────────────────

export interface StructuredTaskState {
  /** Original user objective */
  objective: string;
  /** Current phase/status */
  phase: TaskState;
  /** Completed work items (summary strings) */
  completedWork: string[];
  /** Pending work items */
  pendingWork: string[];
  /** Blocked work items with reason */
  blockedWork: Array<{ item: string; reason: string }>;
  /** Important architectural decisions made */
  architecturalDecisions: string[];
  /** User-specified constraints */
  userConstraints: string[];
  /** Files that have been read */
  filesRead: string[];
  /** Files that have been modified */
  filesModified: string[];
  /** Current known errors */
  knownErrors: string[];
  /** Last test state */
  testState: 'unknown' | 'passing' | 'failing' | 'not-run';
  /** Last build state */
  buildState: 'unknown' | 'passing' | 'failing' | 'not-run';
  /** What the agent intends to do next */
  nextIntendedAction: string | null;
  /** Currently selected model ID */
  currentModelId: string;
  /** Credits used so far in this session */
  creditsUsed: string;
  /** Timestamp of last update */
  updatedAt: string;
}

// ─── Checkpoint ────────────────────────────────────────────────────────────

export interface SessionCheckpoint {
  checkpointId: string;
  sessionId: string;
  taskId: string | null;
  reason: string;
  structuredState: StructuredTaskState;
  /** Git HEAD SHA at checkpoint time */
  gitHead: string | null;
  /** Git branch name */
  gitBranch: string | null;
  /** Working-tree hash (null if unavailable) */
  workingTreeHash: string | null;
  modelId: string;
  creditsUsed: string;
  createdAt: string;
}

// ─── Canonical Agent Session ───────────────────────────────────────────────

export interface AgentSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
  /** Human-readable original objective */
  objective: string;
  status: AgentSessionStatus;
  /** Currently active task ID */
  activeTaskId: string | null;
  /** Currently selected model ID */
  currentModelId: string;
  /** Structured recoverable state */
  structuredState: StructuredTaskState | null;
  /** ID of the most recent checkpoint */
  lastCheckpointId: string | null;
  /** Credit state */
  totalCreditsReserved: string;
  totalCreditsSettled: string;
  createdAt: string;
  updatedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
}

// ─── SessionStore Port ─────────────────────────────────────────────────────

export interface SessionStore {
  createSession(session: Omit<AgentSession, 'createdAt' | 'updatedAt'>): Promise<AgentSession>;
  getSession(sessionId: string): Promise<AgentSession | undefined>;
  updateSession(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession>;
  saveCheckpoint(checkpoint: SessionCheckpoint): Promise<SessionCheckpoint>;
  getCheckpoint(checkpointId: string): Promise<SessionCheckpoint | undefined>;
  getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | undefined>;
  listSessions(userId: string): Promise<AgentSession[]>;
}

// ─── In-Memory SessionStore ────────────────────────────────────────────────

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly checkpoints = new Map<string, SessionCheckpoint>();
  private readonly checkpointsBySession = new Map<string, SessionCheckpoint[]>();

  async createSession(
    session: Omit<AgentSession, 'createdAt' | 'updatedAt'>,
  ): Promise<AgentSession> {
    const now = new Date().toISOString();
    const full: AgentSession = { ...session, createdAt: now, updatedAt: now };
    this.sessions.set(session.sessionId, full);
    return { ...full };
  }

  async getSession(sessionId: string): Promise<AgentSession | undefined> {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : undefined;
  }

  async updateSession(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    const updated: AgentSession = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(sessionId, updated);
    return { ...updated };
  }

  async saveCheckpoint(checkpoint: SessionCheckpoint): Promise<SessionCheckpoint> {
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
    const list = this.checkpointsBySession.get(checkpoint.sessionId) ?? [];
    list.push(checkpoint);
    this.checkpointsBySession.set(checkpoint.sessionId, list);
    return { ...checkpoint };
  }

  async getCheckpoint(checkpointId: string): Promise<SessionCheckpoint | undefined> {
    const c = this.checkpoints.get(checkpointId);
    return c ? { ...c } : undefined;
  }

  async getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | undefined> {
    const list = this.checkpointsBySession.get(sessionId);
    if (!list || list.length === 0) return undefined;
    return { ...list[list.length - 1]! };
  }

  async listSessions(userId: string): Promise<AgentSession[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId).map((s) => ({ ...s }));
  }
}
