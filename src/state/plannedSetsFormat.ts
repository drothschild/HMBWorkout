// pattern: Functional Core
/**
 * Rendering a routine entry's prescription (#276 Phase 3).
 *
 * Two shapes, both pure and both here rather than in the screens, because
 * `src/app` and `src/components` are invisible to every jest suite (AGENTS.md
 * Testing gotchas) — a formatter written inline in a `.tsx` has no cover at all.
 *
 *  - `formatPlannedSetLine` — one row per prescribed set. This is what makes a
 *    warmup ramp *visible*: three rows with three loads, which the aggregate
 *    model could only have rendered as "3w".
 *  - `formatPlannedSetsSummary` — the one-line reduction, for lists that have
 *    room for a single string per exercise.
 *
 * Both return `''` (or nothing renderable) for an entry that prescribes no
 * sets; every caller hides the row rather than printing "0 sets", the same
 * convention the two set-position label builders follow.
 */

import type { RoutineSetEntry } from '@/db/repository';
import { formatWeightLbs } from './weightUnits';

/** Whole seconds as `m:ss`, matching the session screen's timers. */
function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * `8–10` when the pair is a genuine rep range, `''` otherwise. An en dash, not
 * a hyphen: this is a range.
 *
 * This is the ONLY place the range template lives. It is exported (#311)
 * because the in-session set logger has to show the athlete the same range the
 * routine screen shows, and a second `${lo}–${hi}` somewhere else is how the
 * two surfaces start printing the same plan two different ways.
 *
 * `''` rather than undefined for the non-range cases: it is what the callers
 * that render this directly already read as *hide*, matching the convention
 * every label builder in `sessionPresenter.ts` follows.
 *
 * Not a range, and therefore `''`:
 *  - no upper bound at all (`8` is an exact prescription, not a range)
 *  - a degenerate range (`8–8` reads as a mistake in the plan)
 *  - a non-positive bound on either end. Zero is absence, not a bound, and the
 *    shell reads sentinels rather than Options (engine convention 8) — without
 *    this a `repsMax` of 0 renders `8–0`.
 */
export function formatRepRange(
  reps: number | null | undefined,
  repsMax: number | null | undefined
): string {
  if (reps == null || reps <= 0) return '';
  if (repsMax == null || repsMax <= 0 || repsMax === reps) return '';
  return `${reps}–${repsMax}`;
}

/** `8`, or `8–10` for a range. */
function formatReps(set: RoutineSetEntry): string | undefined {
  if (set.targetReps == null) return undefined;
  return formatRepRange(set.targetReps, set.targetRepsMax) || `${set.targetReps}`;
}

/** 1-based position within the entry's run of same-typed sets. */
function positionLabel(index: number, sets: readonly RoutineSetEntry[]): string {
  const isWarmup = sets[index]?.setType === 'warmup';
  const number =
    sets.slice(0, index).filter((set) => (set.setType === 'warmup') === isWarmup).length + 1;
  return isWarmup ? `Warmup ${number}` : `Set ${number}`;
}

/**
 * One prescribed set as a display row: its position within its own type's run,
 * then whatever it actually prescribes.
 *
 * The whole list is passed because the position is a count over it — the array
 * index alone cannot say "Warmup 2" when a working set sits in between
 * (INTERLEAVE).
 */
export function formatPlannedSetLine(
  set: RoutineSetEntry,
  index: number,
  sets: readonly RoutineSetEntry[]
): string {
  const parts: string[] = [];

  const reps = formatReps(set);
  if (reps != null && set.targetWeightKg != null) {
    parts.push(`${reps} × ${formatWeightLbs(set.targetWeightKg)}`);
  } else if (reps != null) {
    parts.push(`${reps} reps`);
  } else if (set.targetWeightKg != null) {
    parts.push(formatWeightLbs(set.targetWeightKg));
  }

  if (set.targetDurationSeconds != null) parts.push(formatDuration(set.targetDurationSeconds));
  if (set.targetDistanceM != null) parts.push(`${set.targetDistanceM} m`);

  const position = positionLabel(index, sets);
  return parts.length > 0 ? `${position} · ${parts.join(' ')}` : position;
}

/**
 * True when the entry's sets do NOT all prescribe the same thing — the case a
 * one-line summary cannot represent honestly, and the only case worth spending
 * screen rows on.
 *
 * A warmup ramp is the canonical yes. A flat 3×8 is a no: three identical rows
 * say nothing "3×8" did not. Set TYPE is deliberately excluded from the
 * comparison — the summary already reports the warmup count.
 */
export function hasVaryingSets(sets: readonly RoutineSetEntry[]): boolean {
  if (sets.length < 2) return false;

  const shapeOf = (set: RoutineSetEntry) =>
    [
      set.targetReps ?? '',
      set.targetRepsMax ?? '',
      set.targetWeightKg ?? '',
      set.targetDurationSeconds ?? '',
      set.targetDistanceM ?? '',
    ].join('|');

  const first = shapeOf(sets[0]);
  return sets.some((set) => shapeOf(set) !== first);
}

/**
 * The whole prescription in one line: the warmup count (which carries no single
 * load to quote — that is the ramp's whole point) plus the working sets'
 * prescription.
 */
export function formatPlannedSetsSummary(sets: readonly RoutineSetEntry[]): string {
  if (sets.length === 0) return '';

  const warmups = sets.filter((set) => set.setType === 'warmup').length;
  const working = sets.filter((set) => set.setType !== 'warmup');

  const parts: string[] = [];
  if (warmups > 0) parts.push(`${warmups} warmup`);

  if (working.length > 0) {
    // The first working set's prescription stands for the group, matching the
    // aggregate reading the shell has always used. A working list with genuinely
    // mixed prescriptions is rendered honestly only by the per-set rows above.
    const first = working[0];
    const reps = formatReps(first);
    if (reps != null) {
      parts.push(`${working.length}×${reps}`);
    } else if (first.targetDurationSeconds != null) {
      parts.push(`${working.length}×${formatDuration(first.targetDurationSeconds)}`);
    } else {
      parts.push(`${working.length} ${working.length === 1 ? 'set' : 'sets'}`);
    }
  }

  return parts.join(' + ');
}
