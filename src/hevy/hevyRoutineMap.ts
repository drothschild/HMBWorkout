/**
 * Hevy routine JSON → the shape `applyRoutineImport` consumes (#267 Phase 3).
 *
 * PURE, deliberately, and for the same reason `importRoutine` is: the screen
 * has no jest project (AGENTS.md), so every decision that can be got wrong
 * lives here where the node project can execute it. `hevyClient.ts` fetches,
 * `applyRoutineImport` (Phase 2, reused unchanged) writes, and everything in
 * between is this file.
 *
 * It emits an `ImportedRoutine` — the SAME type the markdown importer emits —
 * so the DB half is genuinely shared rather than merely similar. A routine that
 * came from Hevy must be indistinguishable from one the coach wrote by the time
 * the engine sees it.
 *
 * ## The mapping table, as rules
 *
 * - **Order is `exercise.index`, never `superset_id`** (AC3.1). Entries are
 *   sorted by `index` and `order` is the resulting position. PUSH's ids run
 *   5,6,7,4, so a sort by id is a visible reordering — which is the whole
 *   reason PUSH is the fixture.
 * - **Set types are 1:1 where they can be.** `warmup`→`warmup`, `normal`→
 *   `normal`. Hevy also has `dropset` and `failure`, which `RoutineSetType`
 *   cannot hold; those become `normal` and the flattening is NAMED in the
 *   lossiness summary rather than swallowed.
 * - **Weight is kg rounded to 2dp, with NO unit round trip** (AC3.5). Rounding
 *   kg agrees with `lbsToKg(kgToLbs(kg))` for every imperial value in PUSH but
 *   is strictly better for a metric-native account, where the round trip drifts
 *   ~0.05 kg for no display benefit. There is exactly one conversion site in
 *   this app (`lbsToKg` in `acceptDraft`) and this is deliberately not a second.
 * - **A `0` measurement is ABSENT, not zero** (AC3.4). Hevy writes `0` for "not
 *   applicable" — Cycling's warmup carries `weight_kg: 0, reps: 0` while
 *   genuinely being a 2000 m / 300 s effort. Storing the zeros would render as
 *   "0 kg × 0 reps".
 * - **`rest_seconds` is the exception to that rule.** A rest of 0 is a real
 *   "no rest" (AGENTS.md, #281) and is kept as 0. The 0 → absent rule is scoped
 *   to the per-set *measurements*.
 * - **`reps` outranks `rep_range`** (AC3.3). They agree everywhere in PUSH, so
 *   the precedence is pinned by a synthetic disagreeing fixture. A degenerate
 *   `{n,n}` collapses to a bare `targetReps`, since an exact prescription is
 *   not a range.
 * - **Notes are per-routine.** `exercise.notes` → `routine_exercises.notes`,
 *   NEVER `exercises.description` (AC3.7). Exercises are global and shared by
 *   every routine, so an import must not rewrite one out from under another.
 *   `ImportedExercise` has no description field at all, which is what makes
 *   that structural rather than a rule someone has to remember.
 * - **A non-contiguous superset is DEMOTED, not rejected** (AC3.6, per the
 *   2026-08-19 decision on #267 — this overrides the design plan's original
 *   "reject with a named error"). See `demoteSplitSupersets` below.
 *
 * ## What it still refuses
 *
 * Three shapes, each one an existing refusal restated rather than a new taste:
 * a routine with no exercises, a routine where EVERY entry prescribes zero sets
 * (`startSessionFromRoutine` refuses exactly this, so importing one just to
 * have it render unstartable helps nobody), and a negative or non-finite
 * `weight_kg`. A routine where only SOME entries are empty is legal and is
 * accepted — engine convention 10 handles it.
 */

import { slugifyTitle } from '@/ai/draftSchema';
import type { ExerciseKind } from '@/db/models/Exercise';
import type { RoutineExerciseEntry, RoutineSetEntry, RoutineSetType } from '@/db/repository';
import { groupBySupersetRuns } from '@/domain/supersetGrouping';
import type { ImportedExercise, ImportedRoutine } from '@/interop/importRoutine';
import type { HevyExercise, HevyRoutine, HevySet } from './types';

export type HevyLossinessCode =
  /** Hevy's own exercise identity has no column here; re-import matches by slug. */
  | 'dropped-template-ids'
  /** Hevy carries no exercise kind, so ours is a guess from the set measurements. */
  | 'inferred-kind'
  /** A `dropset`/`failure` set became `normal`; `RoutineSetType` holds two values. */
  | 'set-type-flattened'
  /** A label split across a gap; its members lost their grouping (AC3.6). */
  | 'superset-demoted'
  /** Target RPE / custom metric present on the wire with nowhere to go. */
  | 'dropped-set-fields'
  /** Two different Hevy titles slugified to one exercise id, merging them. */
  | 'slug-collision';

/**
 * One thing the import could not carry across, named **by content**.
 *
 * `subjects` is the content itself — titles, ids, a label — never a count, and
 * `message` is built from it. AC3.8 is explicit that a count is not a report:
 * "12 exercises lost their template id" tells the user nothing they can act on.
 */
export interface HevyLossinessNote {
  code: HevyLossinessCode;
  subjects: string[];
  /** Renderable as-is, and names every subject. */
  message: string;
}

export type HevyMapErrorCode = 'empty-routine' | 'no-planned-sets' | 'invalid-weight';

export interface HevyMapError {
  code: HevyMapErrorCode;
  message: string;
}

export type HevyRoutineMapResult =
  | { ok: true; routine: ImportedRoutine; lossiness: HevyLossinessNote[] }
  | { ok: false; error: HevyMapError };

function failure(code: HevyMapErrorCode, message: string): HevyRoutineMapResult {
  return { ok: false, error: { code, message } };
}

/** Thrown internally by the set mapper; converted to an `ok: false` at the top. */
class HevyMapRefusal extends Error {
  constructor(
    readonly code: HevyMapErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'HevyMapRefusal';
  }
}

/**
 * A positive, finite measurement, or `undefined`.
 *
 * The single gate every per-set measurement passes through, so "0 means
 * absent" is one rule rather than four copies of it. `null`, `undefined`, `0`
 * and a negative all collapse to `undefined`; a non-finite value would too, but
 * weight checks for that separately and refuses instead — a NaN load is a
 * corrupt payload, not a missing one.
 */
function positiveOrAbsent(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * Kilograms to 2 decimal places. Explicitly NOT `lbsToKg(kgToLbs(kg))`.
 *
 * `Number(x.toFixed(2))` rather than `Math.round(x * 100) / 100` so the
 * rounding is decimal rather than binary — the two disagree on values that sit
 * exactly between representable hundredths, and `toFixed` is the one that
 * matches what the user reads in Hevy.
 */
function roundKg(kg: number): number {
  return Number(kg.toFixed(2));
}

function mapWeight(set: HevySet, where: string): number | undefined {
  const raw = set.weight_kg;
  if (raw == null) return undefined;
  if (!Number.isFinite(raw) || raw < 0) {
    throw new HevyMapRefusal(
      'invalid-weight',
      `${where} carries a weight of ${String(raw)} kg, which is not a load this app can store.`
    );
  }
  const positive = positiveOrAbsent(raw);
  return positive === undefined ? undefined : roundKg(positive);
}

/**
 * `reps` wins over `rep_range`, and a degenerate range collapses to one number.
 *
 * Returns the two rep fields together rather than separately, because the rule
 * is about which SOURCE is consulted — splitting it into two functions is how
 * `targetReps` from one source ends up beside `targetRepsMax` from the other.
 */
function mapReps(set: HevySet): { targetReps?: number; targetRepsMax?: number } {
  const reps = positiveOrAbsent(set.reps);
  if (reps !== undefined) {
    // `reps` present and real: the range, agreeing or not, is not consulted.
    return { targetReps: reps };
  }

  const start = positiveOrAbsent(set.rep_range?.start);
  const end = positiveOrAbsent(set.rep_range?.end);
  if (start === undefined) return end === undefined ? {} : { targetReps: end };
  // `start === end` is an exact prescription, not a range of one.
  if (end === undefined || end <= start) return { targetReps: start };
  return { targetReps: start, targetRepsMax: end };
}

const HEVY_SET_TYPES: Record<string, RoutineSetType> = {
  warmup: 'warmup',
  normal: 'normal',
};

function mapSet(set: HevySet, where: string): RoutineSetEntry {
  const entry: RoutineSetEntry = { setType: HEVY_SET_TYPES[set.type] ?? 'normal' };

  const { targetReps, targetRepsMax } = mapReps(set);
  if (targetReps !== undefined) entry.targetReps = targetReps;
  if (targetRepsMax !== undefined) entry.targetRepsMax = targetRepsMax;

  const weight = mapWeight(set, where);
  if (weight !== undefined) entry.targetWeightKg = weight;

  const duration = positiveOrAbsent(set.duration_seconds);
  if (duration !== undefined) entry.targetDurationSeconds = duration;

  const distance = positiveOrAbsent(set.distance_meters);
  if (distance !== undefined) entry.targetDistanceM = distance;

  // `restSeconds` is deliberately never set: Hevy stores rest per EXERCISE, and
  // inventing a per-set value here would forge a distinction the source does
  // not make (AC3.7).
  return entry;
}

/** Cardio iff any set measures distance; `stretch` is never inferred (AC3.8). */
function inferKind(exercise: HevyExercise): ExerciseKind {
  const hasDistance = exercise.sets.some((set) => positiveOrAbsent(set.distance_meters) !== undefined);
  return hasDistance ? 'cardio' : 'strength';
}

function mapEntry(exercise: HevyExercise, order: number): RoutineExerciseEntry {
  const entry: RoutineExerciseEntry = {
    exerciseId: slugifyTitle(exercise.title),
    order,
    sets: exercise.sets.map((set, index) => mapSet(set, `${exercise.title} set ${index + 1}`)),
  };

  if (exercise.superset_id != null) entry.supersetGroup = String(exercise.superset_id);
  // Kept when 0: a rest of 0 is a real "no rest", unlike a 0 measurement.
  if (exercise.rest_seconds != null && Number.isFinite(exercise.rest_seconds)) {
    entry.restSeconds = exercise.rest_seconds;
  }
  const notes = exercise.notes?.trim();
  if (notes) entry.notes = notes;

  return entry;
}

/**
 * Strip the superset label from every member of any label that owns more than
 * one contiguous run, and report each demotion.
 *
 * **This is the 2026-08-19 override of AC3.6.** The design plan specified
 * rejecting the whole import with a named error; the user chose the softening.
 * The reasoning: a refused import gives the user nothing and no path forward,
 * whereas a demoted superset still yields a usable routine — and the lossiness
 * summary, which Phase 3 shows BEFORE the write, is already the designed
 * channel for "we could not represent X".
 *
 * The engine is why the label cannot simply be kept: `h.group_end_idx` scans
 * FORWARD for a contiguous run (engine conventions 9/10), so a label split
 * across a gap is not two groups to the engine — it is one group ending at the
 * gap plus a stray. Importing it unchanged would produce a routine that runs
 * differently from the one in Hevy.
 *
 * The third option — reordering entries so the group becomes contiguous —
 * stays rejected. Silently rewriting the user's exercise order is the one
 * surprise an import path must never produce, so this function only ever
 * REMOVES labels and never moves an entry. Contiguity is decided by the shared
 * `groupBySupersetRuns` rather than a walk written here, per AGENTS.md
 * Boundaries: no site writes its own contiguity walk.
 *
 * Mutates nothing — returns fresh entries.
 */
function demoteSplitSupersets(
  entries: readonly RoutineExerciseEntry[],
  titleByOrder: readonly string[]
): { entries: RoutineExerciseEntry[]; notes: HevyLossinessNote[] } {
  const runs = groupBySupersetRuns(entries, (entry) => entry.supersetGroup);

  const runCount = new Map<string, number>();
  for (const run of runs) {
    if (run.label === null) continue;
    runCount.set(run.label, (runCount.get(run.label) ?? 0) + 1);
  }

  const split = [...runCount.entries()].filter(([, count]) => count > 1).map(([label]) => label);
  if (split.length === 0) return { entries: [...entries], notes: [] };

  const splitLabels = new Set(split);
  const demoted = entries.map((entry) => {
    if (entry.supersetGroup === undefined || !splitLabels.has(entry.supersetGroup)) return entry;
    // Rebuild without the label rather than deleting off a copy, so the absent
    // case is genuinely absent and not an own property holding `undefined`.
    const { supersetGroup: _dropped, ...rest } = entry;
    return rest;
  });

  const notes = split.map((label): HevyLossinessNote => {
    const subjects = entries
      .filter((entry) => entry.supersetGroup === label)
      .map((entry) => titleByOrder[entry.order] ?? entry.exerciseId);
    return {
      code: 'superset-demoted',
      subjects,
      message:
        `Superset ${label} is split across the routine in Hevy, and this app can only run a superset ` +
        `whose exercises are listed one after another. ${subjects.join(' and ')} were imported as ` +
        `ordinary exercises instead, in their original order. Every other superset kept its grouping.`,
    };
  });

  return { entries: demoted, notes };
}

/**
 * The distinct exercises the routine names, in first-appearance order.
 *
 * A routine may list the same exercise more than once (AGENTS.md Boundaries),
 * so this de-duplicates over ENTRIES rather than mapping them 1:1. Two
 * different Hevy titles can also slugify to one id; the first title wins the
 * record (create-only, so an existing exercise wins over both) and the merge is
 * reported.
 */
function distinctExercises(
  exercises: readonly HevyExercise[]
): { exercises: ImportedExercise[]; notes: HevyLossinessNote[] } {
  const byId = new Map<string, ImportedExercise>();
  const titlesById = new Map<string, string[]>();

  for (const exercise of exercises) {
    const id = slugifyTitle(exercise.title);
    const titles = titlesById.get(id) ?? [];
    if (!titles.includes(exercise.title)) titles.push(exercise.title);
    titlesById.set(id, titles);

    if (byId.has(id)) continue;
    byId.set(id, { id, title: exercise.title, kind: inferKind(exercise) });
  }

  const collisions = [...titlesById.entries()].filter(([, titles]) => titles.length > 1);
  const notes: HevyLossinessNote[] = collisions.length === 0
    ? []
    : [
        {
          code: 'slug-collision',
          subjects: collisions.map(([id, titles]) => `${titles.join(' / ')} → ${id}`),
          message:
            `These Hevy exercises share one name once punctuation is removed, so they became a ` +
            `single exercise here: ${collisions.map(([id, titles]) => `${titles.join(' / ')} → ${id}`).join('; ')}.`,
        },
      ];

  return { exercises: [...byId.values()], notes };
}

/** Every per-set field on the wire that this app has no column for. */
function droppedSetFieldNotes(exercises: readonly HevyExercise[]): HevyLossinessNote[] {
  const subjects: string[] = [];
  for (const exercise of exercises) {
    exercise.sets.forEach((set, index) => {
      if (set.rpe != null) subjects.push(`${exercise.title} set ${index + 1}: target RPE ${set.rpe}`);
      if (set.custom_metric != null) {
        subjects.push(`${exercise.title} set ${index + 1}: custom metric ${set.custom_metric}`);
      }
    });
  }
  if (subjects.length === 0) return [];
  return [
    {
      code: 'dropped-set-fields',
      subjects,
      message: `These prescribed values have no place in this app and were not imported: ${subjects.join('; ')}.`,
    },
  ];
}

/** `dropset`/`failure` → `normal`, named set by set. */
function flattenedSetTypeNotes(exercises: readonly HevyExercise[]): HevyLossinessNote[] {
  const subjects: string[] = [];
  for (const exercise of exercises) {
    exercise.sets.forEach((set, index) => {
      if (HEVY_SET_TYPES[set.type] === undefined) {
        subjects.push(`${exercise.title} set ${index + 1}: ${set.type} → normal`);
      }
    });
  }
  if (subjects.length === 0) return [];
  return [
    {
      code: 'set-type-flattened',
      subjects,
      message:
        `This app knows only warmup and working sets, so these became ordinary working sets: ` +
        `${subjects.join('; ')}.`,
    },
  ];
}

function templateIdNotes(exercises: readonly HevyExercise[]): HevyLossinessNote[] {
  const subjects = exercises
    .filter((exercise) => exercise.exercise_template_id != null && exercise.exercise_template_id !== '')
    .map((exercise) => `${exercise.title} (${exercise.exercise_template_id})`);
  if (subjects.length === 0) return [];
  return [
    {
      code: 'dropped-template-ids',
      subjects,
      message:
        `Hevy's own exercise ids are not stored, so re-importing matches these by name instead: ` +
        `${subjects.join(', ')}.`,
    },
  ];
}

function inferredKindNotes(imported: readonly ImportedExercise[]): HevyLossinessNote[] {
  const subjects = imported.map((exercise) => `${exercise.title} → ${exercise.kind}`);
  if (subjects.length === 0) return [];
  return [
    {
      code: 'inferred-kind',
      subjects,
      message:
        `Hevy does not record what kind of exercise something is, so each was guessed from what it ` +
        `measures — anything with a distance is cardio, everything else is strength, and a stretch ` +
        `or cool-down therefore arrives as strength: ${subjects.join(', ')}.`,
    },
  ];
}

/**
 * Read a Hevy routine.
 *
 * Returns the routine plus everything the mapping could not carry, or a NAMED
 * error — never a partial result and never a throw. A caller that gets
 * `ok: false` must write nothing; a caller that gets `ok: true` must show
 * `lossiness` to the user BEFORE writing, which is the whole reason it is
 * returned alongside rather than logged.
 */
export function mapHevyRoutine(routine: HevyRoutine): HevyRoutineMapResult {
  const source = [...(routine.exercises ?? [])].sort((a, b) => a.index - b.index);

  if (source.length === 0) {
    return failure('empty-routine', 'That Hevy routine lists no exercises.');
  }

  let mappedEntries: RoutineExerciseEntry[];
  try {
    mappedEntries = source.map((exercise, order) => mapEntry(exercise, order));
  } catch (error) {
    if (error instanceof HevyMapRefusal) return failure(error.code, error.message);
    throw error;
  }

  if (mappedEntries.every((entry) => entry.sets.length === 0)) {
    return failure(
      'no-planned-sets',
      'That Hevy routine plans no sets, so it could never be started.'
    );
  }

  const titleByOrder = source.map((exercise) => exercise.title);
  const { entries, notes: supersetNotes } = demoteSplitSupersets(mappedEntries, titleByOrder);
  const { exercises, notes: collisionNotes } = distinctExercises(source);

  const name = routine.title?.trim() || 'Imported Routine';

  return {
    ok: true,
    routine: { name, entries, exercises },
    lossiness: [
      ...supersetNotes,
      ...flattenedSetTypeNotes(source),
      ...droppedSetFieldNotes(source),
      ...collisionNotes,
      ...templateIdNotes(source),
      ...inferredKindNotes(exercises),
    ],
  };
}
