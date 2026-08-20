// pattern: Functional Core
/**
 * How every AI surface says what a plan prescribes (#276 Phase 4).
 *
 * One grammar, four callers: the routines section of `buildSystem`, the debrief
 * target, the alternates prompt and the rest commentary prompt — plus the
 * coach screen's draft preview, which reads the SAME grammar in the model's own
 * unit. That is deliberate rather than tidy: the routines section is the
 * coach's worked example of the format it must then produce, so the two
 * drifting apart is the model being shown one shape and asked for another.
 *
 * The reason this exists at all is AC4.11's regression: a summarised
 * "3 warmup sets" line means the coach cannot see the ramp it wrote last week
 * and will flatten it on the next revision. The run-length rule below collapses
 * only ADJACENT identical sets, so four identical working sets read as
 * "4 × 8-10 reps @ 50lbs" while three ascending warmups keep all three loads.
 *
 * Three input shapes reach it, and they differ in more than field names:
 * `RoutineSet` (engine) and `RoutineSetEntry` (database) carry canonical kg,
 * while `DraftSet` carries the pounds the model speaks. They are normalised to
 * one view here rather than converted between each other — a draft rendered by
 * way of kg would be a second lbs→kg conversion site, and AGENTS.md allows
 * exactly one (`acceptDraft`).
 */

import type { RoutineSet } from '@/engine/types';
import type { RoutineSetEntry } from '@/db/repository';
import { formatLbs, kgToLbs } from '@/state/weightUnits';
import type { DraftSet } from './draftSchema';

/** The normalised shape the grammar reads. Loads are always in display lbs. */
export interface PlanSetView {
  isWarmup: boolean;
  reps?: number | null;
  repsMax?: number | null;
  weightLbs?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  /**
   * This set's own rest override in seconds (#308, the read-back half of #281).
   *
   * Absent is not "no rest" — it is "this set inherits the entry's rest", which
   * the caller already renders once per line. So the presence of the field IS
   * the "differs from the entry default" condition, exactly as it is for
   * `weightLbs`; there is nothing to compare against and no default to pass in.
   *
   * Unlike a load, 0 is a real prescription — a drop set is 0 / 0 / full — so
   * this deliberately does NOT get `lbsFromKg`'s `> 0` treatment.
   */
  restSeconds?: number | null;
}

/**
 * Sentinel-aware: `weightKg` reaches the prompts from engine state and from
 * WatermelonDB, so `null` and 0 both mean "no load prescribed". `formatSetMetrics`
 * in the two one-shot prompts makes the same call for logged sets.
 */
function lbsFromKg(kg: number | null | undefined): number | undefined {
  return kg != null && kg > 0 ? kgToLbs(kg) : undefined;
}

export function planSetsFromRoutineSets(sets: readonly RoutineSet[]): PlanSetView[] {
  return sets.map((set) => ({
    isWarmup: set.setType === 'warmup',
    reps: set.reps,
    repsMax: set.repsMax,
    weightLbs: lbsFromKg(set.weightKg),
    durationSeconds: set.durationSeconds,
    distanceM: set.distanceM,
    restSeconds: set.restSeconds,
  }));
}

export function planSetsFromRoutineSetEntries(
  sets: readonly RoutineSetEntry[]
): PlanSetView[] {
  return sets.map((set) => ({
    isWarmup: set.setType === 'warmup',
    reps: set.targetReps,
    repsMax: set.targetRepsMax,
    weightLbs: lbsFromKg(set.targetWeightKg),
    durationSeconds: set.targetDurationSeconds,
    distanceM: set.targetDistanceM,
    restSeconds: set.restSeconds,
  }));
}

/** The draft's loads are already pounds — no conversion, in either direction. */
export function planSetsFromDraftSets(sets: readonly DraftSet[]): PlanSetView[] {
  return sets.map((set) => ({
    isWarmup: set.type === 'warmup',
    reps: set.reps,
    repsMax: set.repsMax,
    weightLbs: set.weightLbs,
    durationSeconds: set.durationSeconds,
    restSeconds: set.restSeconds,
  }));
}

/** `8`, or `8-10` for a genuine range. Hevy emits `{start:5,end:5}`; that is a 5. */
function formatReps(set: PlanSetView): string | undefined {
  if (set.reps == null) return undefined;
  return set.repsMax != null && set.repsMax !== set.reps
    ? `${set.reps}-${set.repsMax}`
    : `${set.reps}`;
}

/**
 * Everything one set prescribes, with no position and no type. `''` when it
 * prescribes nothing, which the callers below turn into "1 set" rather than a
 * dangling separator.
 *
 * The unit suffix comes from `weightUnits.formatLbs`, never from a template
 * here: that module owns the suffix so no read site can regress to kg.
 *
 * Rest is the last part and the only one that can legitimately be 0 (#308).
 * It is a *metric* rather than a line-level annotation on purpose: run-length
 * collapsing in `summarizePlanSets` keys on this string, so a drop set's
 * 0 / 0 / full rest is what breaks its three otherwise-identical sets into the
 * two runs that show the pattern. Rendering it outside the metrics would leave
 * them collapsed into "3 × …" and the read-back would still be lossy.
 */
function formatMetrics(set: PlanSetView): string {
  const parts: string[] = [];

  const reps = formatReps(set);
  if (reps != null) parts.push(`${reps} reps`);
  if (set.weightLbs != null) parts.push(`@ ${formatLbs(set.weightLbs)}`);
  if (set.durationSeconds != null) parts.push(`${set.durationSeconds}s`);
  if (set.distanceM != null) parts.push(`${set.distanceM}m`);
  if (set.restSeconds != null) parts.push(`rest ${set.restSeconds}s`);

  return parts.join(' ');
}

/**
 * The whole prescription in one line.
 *
 * Adjacent sets prescribing the same thing collapse into an `N × …` run; a
 * change in ANY metric, or in warmup/working type, starts a new run. Grouping
 * over the whole list instead of over runs is the mutation this rule exists to
 * prevent — it would render RAMP's three ascending warmups as one.
 *
 * `''` for an entry that prescribes nothing, so the caller can drop the
 * segment rather than print an empty one.
 */
export function summarizePlanSets(sets: readonly PlanSetView[]): string {
  const runs: { isWarmup: boolean; metrics: string; count: number }[] = [];

  for (const set of sets) {
    const metrics = formatMetrics(set);
    const last = runs[runs.length - 1];
    if (last && last.isWarmup === set.isWarmup && last.metrics === metrics) {
      last.count += 1;
    } else {
      runs.push({ isWarmup: set.isWarmup, metrics, count: 1 });
    }
  }

  return runs
    .map((run) => {
      const body =
        run.metrics === ''
          ? run.count > 1
            ? `${run.count} sets`
            : '1 set'
          : run.count > 1
            ? `${run.count} × ${run.metrics}`
            : run.metrics;

      return run.isWarmup ? `warmup ${body}` : body;
    })
    .join(', ');
}

/** 1-based position within the entry's own run of same-typed sets. */
function positionLabel(index: number, sets: readonly DraftSet[]): string {
  const isWarmup = sets[index]?.type === 'warmup';
  const number =
    sets.slice(0, index).filter((set) => (set.type === 'warmup') === isWarmup).length + 1;
  return isWarmup ? `Warmup ${number}` : `Set ${number}`;
}

/**
 * One drafted set as a preview row, for the coach screen's draft card — the
 * last place the ramp is visible before the user accepts it.
 *
 * The whole list is passed because the position is a count over it: the array
 * index alone cannot say "Warmup 2" when a working set sits in between
 * (INTERLEAVE). Mirrors `formatPlannedSetLine` in `src/state/plannedSetsFormat`,
 * which does the same job for a routine already in the database.
 */
export function formatDraftSetLine(
  set: DraftSet,
  index: number,
  sets: readonly DraftSet[]
): string {
  const metrics = formatMetrics(planSetsFromDraftSets([set])[0]);
  const position = positionLabel(index, sets);

  return metrics === '' ? position : `${position} · ${metrics}`;
}
