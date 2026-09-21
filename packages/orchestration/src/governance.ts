import type { ToolPermission } from './contracts.js';

export interface ToolPermissionContext {
  capability: string;
  organizationId?: string;
  roomId?: string;
  userId?: string;
  agentId?: string;
}

export interface ToolPermissionDecision {
  decision: ToolPermission['decision'];
  matched: ToolPermission | null;
  reason: string;
}

const permissionPrecedence: Record<ToolPermission['scope'], number> = {
  ORGANIZATION: 1,
  USER: 2,
  ROOM: 3,
  AGENT: 4,
};

function subjectIdForScope(
  scope: ToolPermission['scope'],
  context: ToolPermissionContext,
): string | undefined {
  switch (scope) {
    case 'ORGANIZATION':
      return context.organizationId;
    case 'USER':
      return context.userId;
    case 'ROOM':
      return context.roomId;
    case 'AGENT':
      return context.agentId;
  }
}

/**
 * Evaluates the local execution permission layer. Missing policy is deny by
 * default; the most specific subject wins, with DENY winning ties.
 */
export function evaluateToolPermission(
  entries: readonly ToolPermission[],
  context: ToolPermissionContext,
): ToolPermissionDecision {
  const candidates = entries.filter(
    (entry) =>
      entry.capability === context.capability &&
      subjectIdForScope(entry.scope, context) === entry.subjectId,
  );
  if (candidates.length === 0) {
    return { decision: 'DENY', matched: null, reason: 'No matching permission policy' };
  }
  const highestPrecedence = Math.max(
    ...candidates.map((entry) => permissionPrecedence[entry.scope]),
  );
  const scoped = candidates.filter(
    (entry) => permissionPrecedence[entry.scope] === highestPrecedence,
  );
  const selected = [...scoped].sort((left, right) => {
    if (left.decision === right.decision) return right.updatedAt.localeCompare(left.updatedAt);
    return left.decision === 'DENY' ? -1 : 1;
  })[0] as ToolPermission;
  return {
    decision: selected.decision,
    matched: selected,
    reason: `${selected.scope} policy ${selected.decision.toLowerCase()}ed ${context.capability}`,
  };
}

export type BudgetScope = 'TASK' | 'AGENT' | 'ROOM' | 'ORGANIZATION';

export interface CreditBudgetCap {
  scope: BudgetScope;
  id: string;
  maxCredits: string;
}

export interface CreditReservationInput {
  reservationId: string;
  estimatedCredits: string;
  taskId?: string;
  agentId?: string;
  roomId?: string;
  organizationId?: string;
}

export interface CreditReservation {
  reservationId: string;
  estimatedCredits: string;
  chargedCredits: string | null;
  status: 'RESERVED' | 'SETTLED' | 'RELEASED';
}

const SCALE = 6n;
const SCALE_FACTOR = 1_000_000n;

function parseCredits(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error(`Invalid credit amount: ${value}`);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole ?? '0') * SCALE_FACTOR + BigInt(fraction.padEnd(Number(SCALE), '0'));
}

function formatCredits(value: bigint): string {
  if (value < 0n) throw new Error('Credit amount cannot be negative');
  const whole = value / SCALE_FACTOR;
  const fraction = (value % SCALE_FACTOR)
    .toString()
    .padStart(Number(SCALE), '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function resourceIds(input: CreditReservationInput): Array<[BudgetScope, string]> {
  return [
    ['TASK', input.taskId],
    ['AGENT', input.agentId],
    ['ROOM', input.roomId],
    ['ORGANIZATION', input.organizationId],
  ].filter((entry): entry is [BudgetScope, string] => Boolean(entry[1]));
}

export class CreditBudgetService {
  private readonly caps = new Map<string, bigint>();
  private readonly consumed = new Map<string, bigint>();
  private readonly reservations = new Map<
    string,
    { input: CreditReservationInput; amount: bigint; result: CreditReservation }
  >();

  constructor(caps: readonly CreditBudgetCap[]) {
    for (const cap of caps) {
      const key = `${cap.scope}:${cap.id}`;
      if (this.caps.has(key)) throw new Error(`Duplicate credit budget: ${key}`);
      this.caps.set(key, parseCredits(cap.maxCredits));
      this.consumed.set(key, 0n);
    }
  }

  reserve(input: CreditReservationInput): CreditReservation {
    const existing = this.reservations.get(input.reservationId);
    if (existing) {
      if (
        existing.input.estimatedCredits !== input.estimatedCredits ||
        JSON.stringify(resourceIds(existing.input)) !== JSON.stringify(resourceIds(input))
      ) {
        throw new Error(`Reservation idempotency conflict: ${input.reservationId}`);
      }
      return existing.result;
    }
    const amount = parseCredits(input.estimatedCredits);
    const resources = resourceIds(input);
    for (const [scope, id] of resources) {
      const key = `${scope}:${id}`;
      const cap = this.caps.get(key);
      if (cap === undefined) throw new Error(`No credit budget configured for ${key}`);
      if ((this.consumed.get(key) ?? 0n) + amount > cap)
        throw new Error(`Credit budget exceeded for ${key}`);
    }
    for (const [scope, id] of resources) {
      const key = `${scope}:${id}`;
      this.consumed.set(key, (this.consumed.get(key) ?? 0n) + amount);
    }
    const result: CreditReservation = {
      reservationId: input.reservationId,
      estimatedCredits: formatCredits(amount),
      chargedCredits: null,
      status: 'RESERVED',
    };
    this.reservations.set(input.reservationId, { input, amount, result });
    return result;
  }

  settle(reservationId: string, chargedCredits: string): CreditReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error(`Unknown credit reservation: ${reservationId}`);
    if (reservation.result.status !== 'RESERVED') return reservation.result;
    const actual = parseCredits(chargedCredits);
    const delta = actual - reservation.amount;
    const resources = resourceIds(reservation.input);
    if (delta > 0n) {
      for (const [scope, id] of resources) {
        const key = `${scope}:${id}`;
        const cap = this.caps.get(key) as bigint;
        if ((this.consumed.get(key) ?? 0n) + delta > cap)
          throw new Error(`Credit budget exceeded while settling ${key}`);
      }
    }
    for (const [scope, id] of resources) {
      const key = `${scope}:${id}`;
      this.consumed.set(key, (this.consumed.get(key) ?? 0n) + delta);
    }
    reservation.result = {
      ...reservation.result,
      chargedCredits: formatCredits(actual),
      status: 'SETTLED',
    };
    return reservation.result;
  }

  release(reservationId: string): CreditReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error(`Unknown credit reservation: ${reservationId}`);
    if (reservation.result.status !== 'RESERVED') return reservation.result;
    for (const [scope, id] of resourceIds(reservation.input)) {
      const key = `${scope}:${id}`;
      this.consumed.set(key, (this.consumed.get(key) ?? 0n) - reservation.amount);
    }
    reservation.result = { ...reservation.result, status: 'RELEASED' };
    return reservation.result;
  }

  remaining(scope: BudgetScope, id: string): string {
    const key = `${scope}:${id}`;
    const cap = this.caps.get(key);
    if (cap === undefined) throw new Error(`No credit budget configured for ${key}`);
    return formatCredits(cap - (this.consumed.get(key) ?? 0n));
  }
}
