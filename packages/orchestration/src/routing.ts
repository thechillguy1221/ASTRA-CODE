import { ModelRouteSchema, type ModelRoute } from './contracts.js';
export interface ModelRouteRequest {
  taskType: 'SEARCH' | 'CODING' | 'ARCHITECTURE' | 'REVIEW' | 'SECURITY';
  difficulty: 'LOW' | 'MEDIUM' | 'HIGH';
  planId: string;
  remainingCredits: string;
  allowedModelIds?: string[];
}
const routeFor = (taskType: ModelRouteRequest['taskType']): ModelRoute['routeClass'] =>
  taskType === 'SEARCH'
    ? 'FAST'
    : taskType === 'ARCHITECTURE'
      ? 'DEEP'
      : taskType === 'REVIEW'
        ? 'REVIEW'
        : taskType === 'SECURITY'
          ? 'SECURITY'
          : 'STANDARD';
function compareCredits(left: string, right: string): number {
  const [lw, lf = ''] = left.split('.');
  const [rw, rf = ''] = right.split('.');
  const whole = BigInt(lw ?? '0') - BigInt(rw ?? '0');
  if (whole !== 0n) return whole < 0n ? -1 : 1;
  const l = BigInt((lf + '0000000000').slice(0, 10));
  const r = BigInt((rf + '0000000000').slice(0, 10));
  return l < r ? -1 : l === r ? 0 : 1;
}
export class ModelRouter {
  constructor(private readonly routes: ModelRoute[]) {
    routes.forEach((route) => ModelRouteSchema.parse(route));
  }
  resolve(input: ModelRouteRequest): { selected: ModelRoute; fallback: ModelRoute[] } {
    const routeClass = routeFor(input.taskType);
    const allowed = new Set(input.allowedModelIds ?? []);
    const candidates = this.routes
      .filter(
        (route) =>
          route.enabled &&
          route.routeClass === routeClass &&
          (route.planIds.length === 0 || route.planIds.includes(input.planId)) &&
          (allowed.size === 0 || allowed.has(route.modelId)) &&
          compareCredits(route.estimatedCredits, input.remainingCredits) <= 0,
      )
      .sort((left, right) => compareCredits(left.estimatedCredits, right.estimatedCredits));
    const selected = candidates[0];
    if (!selected) throw new Error(`No eligible ${routeClass} model route is available`);
    const byId = new Map(this.routes.map((route) => [route.modelId, route]));
    return {
      selected,
      fallback: selected.fallbackModelIds
        .map((id) => byId.get(id))
        .filter((route): route is ModelRoute => Boolean(route && route.enabled)),
    };
  }
}
