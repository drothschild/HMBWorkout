// pattern: Functional Core
/**
 * DERIVATION SEAM (#276, deleted in Phase 6).
 *
 * The rules read `RoutineEntry.sets` exclusively, but the field is optional
 * until the contract phase: engine state persisted by a pre-Phase-3 build comes
 * back through `hydrate` carrying only the four aggregate counts (AGENTS.md
 * engine convention 5 — `hydrate` is not a dispatch and no rule ever validates
 * what it restores), and `upsertRoutineExercise` still writes count columns with
 * no `routine_sets` rows behind them.
 *
 * This module is the single place that expands counts into a list, so the Rill
 * boundary (`engine/index.ts`) and every shell reader can never disagree about
 * what a count-shaped entry means. Phase 6 deletes the whole file along with the
 * counts.
 */

import type { RoutineEntry, RoutineSet } from './types';

/** The four aggregate columns, as any count-shaped source carries them. */
export interface EntryCounts {
  warmupSets?: number | null;
  targetSets?: number | null;
  targetReps?: number | null;
  targetDurationSeconds?: number | null;
}

/**
 * Expand aggregate counts into the flat set list the rules require:
 * `warmupSets` warmups followed by `targetSets` normals, every one of them
 * carrying the entry's single `targetReps`/`targetDurationSeconds` because that
 * is all an aggregate knows. Lossless in this direction — a count says nothing
 * a list cannot.
 *
 * A 0 in either target field means "unset" on the TS side (nothing plans zero
 * reps), so it crosses as absent rather than as a prescribed zero.
 */
export function setsFromCounts(counts: EntryCounts): RoutineSet[] {
  const reps = (counts.targetReps ?? 0) > 0 ? (counts.targetReps as number) : undefined;
  const durationSeconds =
    (counts.targetDurationSeconds ?? 0) > 0 ? (counts.targetDurationSeconds as number) : undefined;
  const make = (setType: RoutineSet['setType']): RoutineSet => ({ setType, reps, durationSeconds });
  return [
    ...Array.from({ length: Math.max(0, counts.warmupSets ?? 0) }, () => make('warmup')),
    ...Array.from({ length: Math.max(0, counts.targetSets ?? 0) }, () => make('normal')),
  ];
}

/**
 * The ordered prescription for an entry: its own `sets` when it has one, the
 * expanded counts otherwise.
 *
 * An entry carrying `sets: []` is honoured as empty, never resurrected from its
 * counts — a DB-built entry that genuinely prescribes nothing is the shape
 * convention 10 exists for, and stale aggregate columns must not un-empty it.
 * Only an *absent* `sets` falls back.
 */
export function entrySets(entry: (EntryCounts & { sets?: RoutineSet[] }) | undefined): RoutineSet[] {
  if (!entry) return [];
  return entry.sets ?? setsFromCounts(entry);
}

/** Narrower alias for the common call shape, so read sites stay readable. */
export type SetListSource = RoutineEntry | undefined;
