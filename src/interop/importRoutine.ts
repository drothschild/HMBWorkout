/**
 * Markdown routine document → the shape `upsertRoutine` consumes (#267 Phase 2).
 *
 * **This is what gives `parse.ts` its first production caller since #203.** The
 * grammar, the parser and the serializer are frozen contracts here; this module
 * only turns `parseRoutine`'s output into `RoutineExerciseEntry[]` and refuses
 * the two document shapes the engine cannot run.
 *
 * PURE, deliberately: no database, no file system, no `expo-*`. The screen reads
 * the picked file and hands over a string, `applyRoutineImport` (`src/state`)
 * does the writing, and every decision in between is here where the node jest
 * project can reach it. A refusal that lived in the screen would be untestable
 * by construction (AGENTS.md: `src/app` is invisible to every suite).
 *
 * ## What it refuses, and why each one is the engine's rule rather than a taste
 *
 * - **A non-contiguous superset label.** `h.group_end_idx` scans FORWARD for a
 *   contiguous run (engine conventions 9/10), so a label split across a gap is
 *   not two groups to the engine — it is one group ending at the gap plus a
 *   stray. Importing it silently would produce a routine that runs differently
 *   from the document it came from. The check goes through
 *   `src/domain/supersetGrouping`, per AGENTS.md Boundaries: no site writes its
 *   own contiguity walk.
 * - **A routine where every entry prescribes nothing.** The same refusal
 *   `startSessionFromRoutine` already makes — a routine with exercises but
 *   nothing for `h.next_active_landing` to land on cannot be started, and
 *   importing one just to have it render as unstartable helps nobody. A routine
 *   where only *some* entries are empty is legal and is accepted (convention 10).
 *
 * Everything else — an unknown flag key, a sets slot that is not `1`, missing
 * frontmatter, a missing workout block — is `parseRoutine`'s own `ContractError`,
 * surfaced here as a named result rather than a thrown exception so the screen
 * has a message to render and the DB half is never reached (AC2.5).
 */

import { ExerciseKind } from '@/db/models/Exercise';
import type { RoutineExerciseEntry, RoutineSetEntry } from '@/db/repository';
import { groupBySupersetRuns } from '@/domain/supersetGrouping';
import { RoutineSetLine, SupersetGroup, WorkoutLine } from './format';
import { parseRoutine } from './parse';

/**
 * An exercise the document names. The markdown carries only the slug, so the
 * title is DERIVED from it and satisfies `slugifyTitle(title) === id` — which is
 * what keeps a re-export byte-identical and what AC2.3 asserts. It is only ever
 * used to CREATE a missing exercise; an existing one keeps its own title and
 * kind (AGENTS.md: the accept path may create but never mutate).
 */
export interface ImportedExercise {
  id: string;
  title: string;
  kind: ExerciseKind;
}

export interface ImportedRoutine {
  name: string;
  notes?: string;
  entries: RoutineExerciseEntry[];
  /** Distinct, in first-appearance order. The create-only input for the DB half. */
  exercises: ImportedExercise[];
}

export type RoutineImportErrorCode =
  /** `parseRoutine` refused the document. */
  | 'unparseable'
  /** A well-formed document whose workout block names no exercises. */
  | 'empty-routine'
  /** A superset label appears in two runs separated by another entry. */
  | 'non-contiguous-superset'
  /** Every entry prescribes zero sets — the routine could never be started. */
  | 'no-planned-sets';

export interface RoutineImportError {
  code: RoutineImportErrorCode;
  /** Renderable as-is. Carries the parser's own wording when it has one. */
  message: string;
}

export type RoutineImportResult =
  | { ok: true; routine: ImportedRoutine }
  | { ok: false; error: RoutineImportError };

function failure(code: RoutineImportErrorCode, message: string): RoutineImportResult {
  return { ok: false, error: { code, message } };
}

/**
 * `bench-press-dumbbell` → `Bench Press Dumbbell`.
 *
 * The inverse of `slugifyTitle` as far as one exists: slugifying the result
 * returns the input, which is the property AC2.3 turns on. Capitalisation and
 * word breaks are a guess — the document never carried the real title — so this
 * only ever names an exercise the install has never seen.
 */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** A superset group is a wrapper around lines; a standalone entry is one line. */
function flattenEntries(exercises: (WorkoutLine | SupersetGroup)[]): WorkoutLine[] {
  return exercises.flatMap((entry) => ('exercises' in entry ? entry.exercises : [entry]));
}

/**
 * Field by field, not by spread. `RoutineSetLine` and `RoutineSetEntry` happen
 * to have the same five optional measurements today; copying explicitly is what
 * makes a future divergence a compile error instead of a silent passenger.
 *
 * `!= null` throughout, and never truthiness: a `set_rest=0` is a drop set's
 * real "no rest between drops" and must not collapse into "inherit the entry
 * rest" (AGENTS.md, #281).
 */
function toSetEntry(line: RoutineSetLine): RoutineSetEntry {
  const set: RoutineSetEntry = { setType: line.setType };
  if (line.targetReps != null) set.targetReps = line.targetReps;
  if (line.targetRepsMax != null) set.targetRepsMax = line.targetRepsMax;
  if (line.targetWeightKg != null) set.targetWeightKg = line.targetWeightKg;
  if (line.targetDurationSeconds != null) set.targetDurationSeconds = line.targetDurationSeconds;
  if (line.targetDistanceM != null) set.targetDistanceM = line.targetDistanceM;
  if (line.restSeconds != null) set.restSeconds = line.restSeconds;
  return set;
}

function toEntry(line: WorkoutLine, order: number): RoutineExerciseEntry {
  const entry: RoutineExerciseEntry = {
    exerciseId: line.exerciseId,
    order,
    sets: (line.sets ?? []).map(toSetEntry),
  };
  if (line.supersetLabel != null && line.supersetLabel !== '') {
    entry.supersetGroup = line.supersetLabel;
  }
  if (line.restSeconds != null) entry.restSeconds = line.restSeconds;
  // The routine document carries a per-exercise note in the `@hint` flag; it is
  // `routine_exercises.notes`, never the global `exercises.description`.
  if (line.hint != null && line.hint !== '') entry.notes = line.hint;
  return entry;
}

/**
 * The first index at which a superset label reappears after its run has ended,
 * or `null` when every label occupies exactly one contiguous run.
 *
 * Goes through the shared helper rather than walking the array here (AGENTS.md
 * Boundaries): `groupBySupersetRuns` already partitions into contiguous runs, so
 * a label owning more than one run is exactly the violation.
 */
function splitSupersetLabel(entries: readonly RoutineExerciseEntry[]): string | null {
  const runs = groupBySupersetRuns(entries, (entry) => entry.supersetGroup);
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.label === null) continue;
    if (seen.has(run.label)) return run.label;
    seen.add(run.label);
  }
  return null;
}

/**
 * The distinct exercises the document names, in first-appearance order.
 *
 * A routine may list the same exercise more than once (AGENTS.md Boundaries), so
 * this is a de-duplication over ENTRIES, not a 1:1 map of them.
 */
function distinctExercises(lines: readonly WorkoutLine[]): ImportedExercise[] {
  const byId = new Map<string, ImportedExercise>();
  for (const line of lines) {
    if (byId.has(line.exerciseId)) continue;
    byId.set(line.exerciseId, {
      id: line.exerciseId,
      title: titleFromSlug(line.exerciseId),
      kind: line.kind,
    });
  }
  return [...byId.values()];
}

/**
 * Read a routine document.
 *
 * Returns the routine, or a NAMED error — never a partial result and never a
 * throw. A caller that gets `ok: false` must write nothing (AC2.5); the reason
 * this returns rather than throws is that `ok: false` is an ordinary outcome of
 * the user picking the wrong file.
 */
export function importRoutine(markdown: string): RoutineImportResult {
  let parsed;
  try {
    parsed = parseRoutine(markdown);
  } catch (error) {
    return failure(
      'unparseable',
      error instanceof Error ? error.message : 'That file is not a routine document.'
    );
  }

  const lines = flattenEntries(parsed.exercises);
  if (lines.length === 0) {
    return failure('empty-routine', 'That routine document lists no exercises.');
  }

  const entries = lines.map(toEntry);

  const split = splitSupersetLabel(entries);
  if (split !== null) {
    return failure(
      'non-contiguous-superset',
      `Superset "${split}" is split across the routine. A superset must be a run of exercises listed one after another.`
    );
  }

  if (entries.every((entry) => entry.sets.length === 0)) {
    return failure(
      'no-planned-sets',
      'That routine plans no sets, so it could never be started.'
    );
  }

  const frontmatter = parsed.frontmatter;
  // A document exported before the `name:` key existed still imports; it just
  // arrives named after its id rather than blank.
  const name = frontmatter.name?.trim() || frontmatter.id?.trim() || 'Imported Routine';
  const notes = frontmatter.notes?.trim();

  const routine: ImportedRoutine = {
    name,
    entries,
    exercises: distinctExercises(lines),
  };
  if (notes) routine.notes = notes;

  return { ok: true, routine };
}
