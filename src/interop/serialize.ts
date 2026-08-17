/**
 * Serializer: DB rows → markdown (Task 2).
 * AC3.2: valid frontmatter, required keys, ✅ token.
 */

import SessionSet, { SetType } from '@/db/models/SessionSet';
import Exercise, { ExerciseKind } from '@/db/models/Exercise';
import {
  formatFlags,
  ContractError,
  type ParsedFlags,
  type RoutineSetLine,
} from './format';

type SessionSetRow = {
  routineExerciseId: string;
  /**
   * The exercise this set was performed as (session_sets.exercise_id). Fills
   * the line's existing identity slot in preference to the routine row's
   * exerciseId: ReplaceExercise re-points that row, so a session still queued
   * for sync would otherwise serialize under whatever the routine names by
   * the time the bridge comes back. Absent on sets written before the column
   * existed — those fall back to the row, as everywhere else.
   */
  exerciseId?: string;
  setType: SetType;
  reps?: number;
  weightKg?: number;
  distanceM?: number;
  durationSeconds?: number;
  rpe?: number;
  position: number;
};

type RoutineExerciseRow = {
  id: string;
  exerciseId: string;
  order: number;
  supersetGroup?: string;
  warmupSets: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
  notes?: string;
};

type ExerciseRow = {
  id: string;
  title: string;
  kind: ExerciseKind;
};

/**
 * Build one logged-set line.
 *
 * `re` is the set's routine_exercises row, or undefined when that row no
 * longer exists. The row supplies only the plan-level flags (superset, rest);
 * identity comes from the set's own stamp first, falling back to the row.
 *
 * @throws ContractError if the set's exercise cannot be resolved. A session's
 * vault copy must never be written silently short of a set that was logged.
 */
function buildSessionSetLine(
  set: SessionSetRow,
  re: RoutineExerciseRow | undefined,
  exercises: ExerciseRow[],
  sessionId: string
): string {
  // What the set was performed as, not what its routine row names today.
  // The row supplies everything else on the line — the prescription belongs
  // to the plan and survives a swap untouched — so only the identity (and
  // the kind read off it) comes from the set.
  const performedExerciseId = set.exerciseId || re?.exerciseId;
  const exerciseData = performedExerciseId
    ? exercises.find((e) => e.id === performedExerciseId)
    : undefined;

  if (!exerciseData) {
    throw new ContractError(
      `session ${sessionId}: cannot resolve the exercise for the set at position ` +
        `${set.position} (routine_exercise_id=${set.routineExerciseId}` +
        `${performedExerciseId ? `, exercise_id=${performedExerciseId}` : ', no exercise_id stamp'}` +
        `). Refusing to export the session without it.`
    );
  }

  // Both documents go through `formatFlags` (#277). This path used to hand-roll
  // its own flag list, and that — not the missing call to `quoteFlagValue` — is
  // the defect: `superset=` is free text, it is the only such value on a session
  // line, and it kept being emitted bare after the routine path learned to quote
  // it, because the two paths had no shared code to teach. Handing `formatFlags`
  // a `ParsedFlags` makes the divergence structurally impossible instead of
  // merely repaired: quoting, `rest`'s m:ss threshold and every other emission
  // rule are applied once, in the file that owns the grammar. Anything a session
  // line needs that a routine line does not belongs in `formatFlags`, not here.
  const flags: ParsedFlags = {};

  // A session line always states its set type, `working` included: unlike a
  // routine's plan flags, it is a measurement, and an absent one would read as
  // "unknown" rather than "the default".
  flags.setType = set.setType;

  // Add kind if not strength (C2)
  if (exerciseData.kind !== 'strength') {
    flags.kind = exerciseData.kind;
  }

  // `!= null` (not `!== undefined`): WatermelonDB returns null, not undefined,
  // for an unset optional column, and a loose null check is the only guard that
  // treats both as "absent" without also rejecting legitimate falsy values
  // like 0. Applies to every optional column read on this line.
  //
  // For `rpe` specifically, 0 is NOT such a legitimate falsy value — the scale
  // starts at 1 — but the check still belongs here rather than in this file
  // (#284). `formatFlags` refuses to write an out-of-scale rpe, which is the
  // same predicate the parser reads by, so the two halves cannot disagree; the
  // guard is deliberately NOT restated here, because a second copy of the
  // bound is how the halves drifted apart in the first place. `weight`'s 0
  // (bodyweight) and `reps`'s 0 (a set of zero reps) are genuinely legitimate
  // and are written as-is.
  if (set.rpe != null) {
    flags.rpe = set.rpe;
  }

  if (set.weightKg != null) {
    flags.weight = set.weightKg;
  }

  if (set.distanceM != null) {
    flags.distance = set.distanceM;
  }

  // Plan-level flags, from the routine_exercises row when it still exists.
  if (re?.supersetGroup) {
    flags.supersetLabel = re.supersetGroup;
  }

  if (re?.restSeconds != null) {
    flags.restSeconds = re.restSeconds;
  }

  // Build set description
  // For sessions: logged sets are emitted as 1x<reps> (not target sets)
  let setDesc = '';
  if (set.reps != null) {
    // Strength: 1x<logged-reps>
    setDesc = `1x${set.reps}`;
  } else if (set.durationSeconds != null) {
    // Cardio/stretch: emit duration as flag (C2)
    flags.durationSeconds = set.durationSeconds;
  }

  const flagStr = formatFlags(flags);
  // Build line: `- <exercise-id>: <setDesc> <flagStr>`, avoiding double space
  const parts = [setDesc, flagStr].filter((p) => p);
  return `- ${exerciseData.id}: ${parts.join(' ')}`;
}

/**
 * Serialize a session to markdown.
 * Includes frontmatter (type, id, date, tags, created), Tasks-plugin ✅ token, and fenced workout block.
 *
 * Every logged set produces a line or the call throws: a session's vault copy
 * is never written silently short of work that was logged.
 */
export function serializeSession(
  sessionRow: {
    id: string;
    routineId: string;
    startedAt: Date;
    endedAt?: Date;
    createdAt: Date;
    customSyncStatus: string;
  },
  sets: SessionSetRow[],
  routineExercises: RoutineExerciseRow[],
  exercises: ExerciseRow[]
): string {
  // Extract date from endedAt (or startedAt if no endedAt)
  const dateObj = sessionRow.endedAt || sessionRow.startedAt;
  const dateStr = dateObj.toISOString().split('T')[0];

  // Build frontmatter
  const createdStr = sessionRow.createdAt.toISOString().split('T')[0];
  const frontmatter = [
    '---',
    'type: workout-session',
    `id: ${sessionRow.id}`,
    `date: ${dateStr}`,
    `tags: []`,
    `created: ${createdStr}`,
    '---',
  ].join('\n');

  // Build workout block
  const workoutLines: string[] = [];

  // Group sets by routine_exercise_id
  const setsByExercise = new Map<string, SessionSetRow[]>();
  for (const set of sets) {
    if (!setsByExercise.has(set.routineExerciseId)) {
      setsByExercise.set(set.routineExerciseId, []);
    }
    setsByExercise.get(set.routineExerciseId)!.push(set);
  }

  const byPosition = (a: SessionSetRow, b: SessionSetRow) => a.position - b.position;

  // Build lines in order of routine_exercises
  const visitedGroups = new Set<string>();
  for (const re of routineExercises) {
    visitedGroups.add(re.id);
    const exerciseSets = setsByExercise.get(re.id) || [];

    // Get all sets for this exercise
    const exerciseSetsInOrder = [...exerciseSets].sort(byPosition);

    // If superset, need to group; handle adjacent superset exercises
    // For now, emit each set as a line with superset flag
    for (const set of exerciseSetsInOrder) {
      workoutLines.push(buildSessionSetLine(set, re, exercises, sessionRow.id));
    }
  }

  // Sets whose routine_exercises row is gone. upsertRoutine's drop branch
  // destroys the row of an exercise removed from a routine, and a finished
  // session still queued as sync_status='local' keeps its sets — so the loop
  // above, which walks surviving rows, would never visit them. Left
  // unhandled, the session posts short and flips to 'synced': the vault copy
  // is permanently missing work the user actually did.
  //
  // Identity survives in the set's own exercise_id stamp (schema v3), which is
  // what buildSessionSetLine reads first anyway. The row supplied only the
  // plan flags (superset, rest); those died with it. Everything the vault must
  // not lose — identity, set_type, reps or duration, weight, rpe — lives on
  // the set. An orphan with no stamp is genuinely unrecoverable and throws
  // rather than vanishing, which leaves the session 'local' and the data
  // on-device.
  //
  // Appended rather than interleaved: with no row there is no `order` to place
  // the group by. Ordering by first-set position keeps output deterministic.
  const orphanedGroups = [...setsByExercise.entries()]
    .filter(([routineExerciseId]) => !visitedGroups.has(routineExerciseId))
    .map(([, groupSets]) => [...groupSets].sort(byPosition))
    .sort((a, b) => a[0].position - b[0].position);

  for (const groupSets of orphanedGroups) {
    for (const set of groupSets) {
      workoutLines.push(buildSessionSetLine(set, undefined, exercises, sessionRow.id));
    }
  }

  // Build body with ✅ token and workout block
  const body = [
    `✅ ${dateStr}`,
    '',
    '```workout',
    ...workoutLines,
    '```',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Serialize a routine to markdown.
 * Includes frontmatter (type, id, updated, created, tags) and fenced workout block.
 *
 * ONE LINE PER PRESCRIBED SET (#276 Phase 5). An entry's `sets` list is written
 * out in order, each set carrying its own reps, rep-range top, load, duration
 * and distance, and repeating the entry-level flags (rest, superset, kind,
 * hint) so every line stands on its own and `parseRoutine` can regroup them.
 *
 * The verbosity is the representation: a warmup ramp is seven lines because it
 * is seven prescribed sets, and changing one warmup weight changes one line.
 * The aggregate form this replaced could not hold a ramp at all.
 *
 * An entry with no sets still emits its exercise line (AC5.8) — the routine
 * names the exercise, and dropping it would say something the data does not.
 *
 * `serializeSession` and `buildSessionSetLine` are untouched by this: a session
 * has always been one line per logged set, which is the shape the routine
 * document has now adopted.
 */
export function serializeRoutine(
  routineRow: {
    id: string;
    name: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
  },
  routineExercises: Array<{
    id: string;
    exerciseId: string;
    order: number;
    supersetGroup?: string;
    restSeconds?: number;
    notes?: string;
    /**
     * The entry's prescribed sets, in order. Absent and `[]` mean the same
     * thing here and both emit a bare exercise line — a distinction the DB
     * does not draw either, since `getRoutineSets` answers `[]` for an entry
     * with no `routine_sets` rows whether or not anything ever wrote any.
     */
    sets?: RoutineSetLine[];
  }>,
  exercises: Array<{
    id: string;
    title: string;
    kind: ExerciseKind;
  }>
): string {
  const createdStr = routineRow.createdAt.toISOString().split('T')[0];
  const updatedStr = routineRow.updatedAt.toISOString().split('T')[0];

  const frontmatter = [
    '---',
    'type: workout-routine',
    `id: ${routineRow.id}`,
    `updated: ${updatedStr}`,
    `tags: []`,
    `created: ${createdStr}`,
    '---',
  ].join('\n');

  // Build workout block
  const workoutLines: string[] = [];

  for (const re of routineExercises) {
    const exerciseData = exercises.find(e => e.id === re.exerciseId);
    if (!exerciseData) continue;

    /**
     * The flags every line of this entry repeats. Rebuilt per line rather than
     * shared, because `formatFlags` reads a mutable record and each line then
     * adds its own set-level fields on top.
     */
    const entryFlags = (): ParsedFlags => {
      const flags: ParsedFlags = {};

      // Add kind if not strength
      if (exerciseData.kind !== 'strength') {
        flags.kind = exerciseData.kind;
      }

      // Add superset if applicable
      if (re.supersetGroup) {
        flags.supersetLabel = re.supersetGroup;
      }

      // Add rest. `!= null`, not `!== undefined`: see the matching comment in
      // serializeSession — WatermelonDB's unset optional columns surface as
      // null here too, and that applies to every optional field on this line.
      if (re.restSeconds != null) {
        flags.restSeconds = re.restSeconds;
      }

      // Add notes as hint if present. Blank-but-non-empty notes are treated as
      // absent (#277) rather than emitting `@""`: a note of pure whitespace
      // carries nothing, and round-tripping it as an empty hint would be a
      // distinction the app has no use for. A note with *content* keeps its
      // surrounding whitespace exactly — `format.ts` quotes it.
      if (re.notes && re.notes.trim() !== '') {
        flags.hint = re.notes;
      }

      return flags;
    };

    const emit = (setDesc: string, flags: ParsedFlags): void => {
      const flagStr = formatFlags(flags);
      // Build line: `- <exercise-id>: <setDesc> <flagStr>`, avoiding double
      // space — and no trailing space when the entry says nothing at all.
      const parts = [setDesc, flagStr].filter(p => p);
      workoutLines.push(`- ${re.exerciseId}:${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`);
    };

    const sets = re.sets ?? [];
    if (sets.length === 0) {
      emit('', entryFlags());
      continue;
    }

    for (const set of sets) {
      const flags = entryFlags();

      // The routine vocabulary is {warmup, normal} and `normal` is spelled by
      // saying nothing — the inverse of a session line, which always states its
      // type because there it is a measurement rather than a plan default.
      if (set.setType === 'warmup') {
        flags.setType = 'warmup';
      }

      if (set.targetRepsMax != null) {
        flags.targetRepsMax = set.targetRepsMax;
      }

      if (set.targetWeightKg != null) {
        flags.targetWeightKg = set.targetWeightKg;
      }

      if (set.targetDurationSeconds != null) {
        flags.durationSeconds = set.targetDurationSeconds;
      }

      if (set.targetDistanceM != null) {
        flags.targetDistanceM = set.targetDistanceM;
      }

      emit(set.targetReps != null ? `1x${set.targetReps}` : '', flags);
    }
  }

  const body = [
    '```workout',
    ...workoutLines,
    '```',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}
