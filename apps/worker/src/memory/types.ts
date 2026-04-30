export type MemoryTier = "short" | "long" | "permanent";

export type MemorySegment =
  | "identity"
  | "preference"
  | "correction"
  | "relationship"
  | "project"
  | "knowledge"
  | "context";

interface SegmentDefaults {
  tier: MemoryTier;
  importance: number;
  decayRate: number;
}

export const SEGMENT_DEFAULTS: Record<MemorySegment, SegmentDefaults> = {
  identity: { tier: "permanent", importance: 0.85, decayRate: 0.01 },
  correction: { tier: "long", importance: 0.8, decayRate: 0.015 },
  relationship: { tier: "long", importance: 0.75, decayRate: 0.02 },
  preference: { tier: "long", importance: 0.7, decayRate: 0.02 },
  project: { tier: "long", importance: 0.65, decayRate: 0.025 },
  knowledge: { tier: "long", importance: 0.6, decayRate: 0.03 },
  context: { tier: "short", importance: 0.4, decayRate: 0.08 },
};

export const DEFAULT_DECAY: Record<MemoryTier, number> = {
  short: 0.05,
  long: 0.02,
  permanent: 0,
};

export function makeMemoryId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PRUNE_THRESHOLD = 0.05;
export const ARCHIVE_THRESHOLD = 0.15;
const DECAY_BETA = 0.8;
export const BASE_HALF_LIFE_DAYS = 11.25;
const LN2 = Math.log(2);

export function effectiveScore(mem: {
  importance: number;
  decayRate: number;
  lastAccessedAt: number;
  accessCount: number;
}): number {
  const daysSinceAccess = Math.max(0, (Date.now() - mem.lastAccessedAt) / DAY_MS);
  const adaptiveHalfLife = BASE_HALF_LIFE_DAYS * (1 + mem.importance);
  const lambda = (LN2 / Math.max(adaptiveHalfLife, 0.001)) * DECAY_BETA;
  const effectiveLambda = lambda * (1 + mem.decayRate);
  const decayed = mem.importance * Math.exp(-effectiveLambda * daysSinceAccess);
  const reinforcement = 1 + Math.log1p(mem.accessCount) * 0.1;
  return Math.max(0, Math.min(1, decayed * reinforcement));
}
