/**
 * Parser: vault markdown → structured. Strict — malformed blocks throw
 * `ContractError` rather than degrading.
 *
 * **This module has no production caller, by design (#262). Do not delete it as
 * dead code.** Vault import was removed in #203 and the export path
 * (`src/export`) uses `serialize` only, so a dead-code sweep will find nothing
 * importing this outside tests. It is kept deliberately, as a *maintained
 * contract*, because it is still doing two real jobs:
 *
 * 1. **It is what enforces the grammar's symmetry.** `format.ts` is the single
 *    source of truth and `serialize.ts` must stay symmetric with it; the
 *    roundtrip tests are the mechanism that holds that true. Delete the parser
 *    and the enforcement goes with it — `serialize` could then drift from the
 *    documented grammar with nothing to notice. 123 of the interop suite's 210
 *    tests involve parsing — all of `parse.test.ts` and `roundtrip.test.ts`,
 *    while `serialize.test.ts` and `format.test.ts` call neither entry point.
 *    (Was "42 of 59", stale since well before #276; re-derive rather than trust
 *    these, since a hardcoded count in prose goes stale by construction. The
 *    same stale pair is still in AGENTS.md and is AC6.5 item 6's job.)
 * 2. **It is the test oracle for the one interop path that IS
 *    production-bound.** `exportService.test.ts` verifies `exportRoutine`'s
 *    output by parsing it back rather than string-matching, so the parser
 *    directly guards the export feature.
 *
 * The consequence for maintenance: changes to `format.ts` or `serialize.ts` must
 * keep this in step, exactly as if it had callers. That is the cost of the
 * option chosen in #262, and it is the point — the alternative was losing the
 * symmetry guard.
 */

import {
  parseFlagTokens,
  tokenizeFlagString,
  ContractError,
  DocContext,
  ParsedDoc,
  RoutineSetLine,
  WorkoutLine,
  SupersetGroup,
} from './format';
import { ExerciseKind } from '@/db/models/Exercise';

/**
 * Extract frontmatter from markdown.
 * Returns record of key=value pairs (ignoring comments, etc).
 * Supports both inline and block-style YAML lists for tags (M1).
 */
function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new ContractError('Missing frontmatter (---)');
  }

  const lines = match[1].split('\n');
  const frontmatter: Record<string, string> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.substring(0, colonIdx).trim();
    const valueStr = line.substring(colonIdx + 1).trim();

    // Handle block-style lists (M1): key: with items on next lines
    if (valueStr === '' && key === 'tags') {
      const tags: string[] = [];
      i++;
      // Collect indented lines starting with "- "
      while (i < lines.length) {
        const nextLine = lines[i];
        if (!nextLine.trim()) {
          i++;
          break;
        }
        // Check if it's an indented list item
        if (nextLine.match(/^\s+- /)) {
          const tag = nextLine.trim().substring(2).trim(); // Remove "- "
          tags.push(tag);
          i++;
        } else {
          // Not a list item, stop collecting
          break;
        }
      }
      // Store tags as comma-separated or array format
      frontmatter[key] = tags.length > 0 ? tags.join(',') : '[]';
      continue;
    }

    // Inline value: strip quotes if present
    frontmatter[key] = valueStr.replace(/^['"]|['"]$/g, '');
    i++;
  }

  return frontmatter;
}

/**
 * Extract the fenced workout block (language tag = `workout`).
 */
function extractWorkoutBlock(markdown: string): string {
  const match = markdown.match(/^```workout\s*\n([\s\S]*?)\n```/m);
  if (!match) {
    throw new ContractError('Missing or malformed workout block (```workout...```)');
  }
  return match[1];
}

/**
 * Parse a single workout line.
 * Format: `- <exercise-id>: [1x<reps>] [flags…]`
 *
 * @param context - 'routine' for author-written targets, 'session' for logged
 *   measurements. It is consulted three times, and only three (#276 Phase 5):
 *   which flag keys are legal (`parseFlagTokens`), whether the sets slot may be
 *   anything other than 1, and which tail the line takes — a routine line is
 *   one prescribed set (or the `sets=0` entry marker) and every field on it is
 *   independently optional, while a session line is a measurement and must say
 *   what was measured. The zero-REPS asymmetry that used to be a third of these
 *   is gone — `1x0` now means the same thing in both documents.
 */
function parseWorkoutLine(line: string, context: DocContext): WorkoutLine | null {
  line = line.trim();
  if (!line.startsWith('- ')) return null;

  // Remove leading "- "
  const content = line.substring(2);

  // Split on first colon: exercise-id and rest
  const colonIdx = content.indexOf(':');
  if (colonIdx === -1) {
    throw new ContractError(`No colon in workout line: ${line}`);
  }

  const exerciseId = content.substring(0, colonIdx).trim();
  const rest = content.substring(colonIdx + 1).trim();

  // Split the rest into parts (sets×reps and flags). Quote-aware (#277): a
  // quoted value holds its whitespace together, so a note reading
  // `@"3x12 = the goal"` is one token and is never mistaken for the sets slot
  // nor scattered across the flag scan below.
  const parts = tokenizeFlagString(rest);
  if (parts.length === 0 && context === 'session') {
    // `- <exercise-id>:` with nothing after it. A session line records a set
    // that happened, and a set that says nothing about itself is not a
    // measurement. A ROUTINE line falls through instead: there it is one
    // prescribed set that prescribes nothing in particular, which is a
    // `routine_sets` row the DB can hold (all five columns are independently
    // nullable). The entry that has no sets AT ALL is a different statement
    // and says so with `sets=0` (#293 review).
    throw new ContractError(`Empty spec after colon in line: ${line}`);
  }

  // Identify sets×reps and flags: sets×reps has format NxM, flags start with key= or @
  let setRepPart: string | undefined;
  let flagParts: string[] = [];

  for (const part of parts) {
    if (part.match(/^\d+x\d+$/)) {
      if (setRepPart) {
        throw new ContractError(`Multiple sets×reps in line: ${line}`);
      }
      setRepPart = part;
    } else {
      flagParts.push(part);
    }
  }

  // Parse flags first to get kind, from the tokens produced above.
  //
  // What is load-bearing is the ORDER — tokenizing the whole spec before the
  // sets×reps scan, so a quoted value holding `3x12` is never taken for the
  // sets slot. Passing tokens rather than a re-joined string is not: tokenizer
  // output has balanced quotes and no unquoted whitespace, which makes
  // `tokenizeFlagString(tokens.join(' ')) === tokens` an identity, so
  // `parseFlags(flagParts.join(' '))` would behave identically here. It is
  // measured, not assumed (#277 review, I1: 0 counterexamples over 3,300
  // inputs, reproduced independently). Passing tokens is simply the direct
  // route; do not "preserve" it as a correctness invariant it is not.
  let parsedFlags: any;
  try {
    parsedFlags = parseFlagTokens(flagParts, context);
  } catch (e) {
    if (e instanceof ContractError) {
      throw e;
    }
    throw new ContractError(`Invalid flags in line: ${line}`);
  }
  const kind = parsedFlags.kind || 'strength';

  // Parse sets×reps (may be empty for cardio/stretch)
  let setsSlot: number | undefined;
  let targetReps: number | undefined;

  if (setRepPart) {
    const match = setRepPart.match(/^(\d+)x(\d+)$/);
    if (!match) {
      throw new ContractError(`Invalid sets×reps format: ${setRepPart}`);
    }
    setsSlot = parseInt(match[1], 10);
    targetReps = parseInt(match[2], 10);

    // 0x10 matches \d+x\d+ (syntactically fine) but "zero sets of N reps" is
    // semantically nonsensical — the same class of problem as cardio/stretch
    // with sets×reps or strength missing sets×reps below, so it is rejected
    // rather than silently defaulted. Neither serializer can emit it: both
    // hardcode the slot to `1`.
    if (setsSlot === 0) {
      throw new ContractError(`Sets×reps cannot have zero sets: ${line}`);
    }

    // A ROUTINE line is one prescribed set (#276 Phase 5), so the slot's first
    // number is always 1. Anything else is a document written against the old
    // `<target-sets>x<target-reps>` overload, and reading `3x8` as a single set
    // of 8 would silently discard two thirds of the author's plan — the exact
    // failure this grammar change exists to end. Refusing is loud and the
    // document is recoverable by hand; a silent misread is neither.
    //
    // Deliberately routine-only rather than universal. `serializeSession` has
    // always hardcoded `1x`, so tightening the session side would be a change
    // to a document shape this phase is not touching (AC5.5).
    if (context === 'routine' && setsSlot !== 1) {
      throw new ContractError(
        `A routine line is one set, so its sets slot must be 1, not ${setsSlot}: ${line}`
      );
    }

    // The zero-REPS rule that used to live here is deleted, not ported (AC5.4).
    // It rejected `3x0` in a routine because "3 sets of nothing" is an empty
    // plan, while accepting `1x0` in a session because performing zero reps is
    // a real measurement. With the slot reading `1x<reps>` in both documents
    // there is no `3x0` left to reject, and `1x0` — one prescribed set of zero
    // reps — means the same odd-but-expressible thing in each. The contexts
    // stop diverging on validation strictness, which is the point.
  }

  // Build workout line
  const workoutLine: WorkoutLine = {
    exerciseId,
    kind,
    setsSlot,
    targetReps,
    targetDurationSeconds: parsedFlags.durationSeconds,
    restSeconds: parsedFlags.restSeconds,
    supersetLabel: parsedFlags.supersetLabel,
    hint: parsedFlags.hint,
    rpe: parsedFlags.rpe,
    weight: parsedFlags.weight,
    distance: parsedFlags.distance,
    targetRepsMax: parsedFlags.targetRepsMax,
    targetWeightKg: parsedFlags.targetWeightKg,
    targetDistanceM: parsedFlags.targetDistanceM,
    setRestSeconds: parsedFlags.setRestSeconds,
    setType: parsedFlags.setType,
  };

  if (context === 'routine') {
    return finishRoutineLine(line, workoutLine, flagParts, parsedFlags.noSets === true);
  }

  // A SESSION line is a measurement, so it must say what was measured. These
  // THREE requirements are the session's alone (#293 review rounds 1 and 2): on
  // a routine line every prescribed field is independently optional, and
  // demanding a duration of a cardio entry that prescribes nothing is what made
  // a bare cardio line unparseable.
  if ((kind === 'cardio' || kind === 'stretch') && parsedFlags.durationSeconds === undefined) {
    throw new ContractError(`${kind} exercise missing duration: ${line}`);
  }

  // The cardio/stretch sets-slot PROHIBITION is the duration requirement's
  // sibling and moves with it (#293 review round 2). Round 1 moved only the
  // duration half and left this one unconditional thirty lines above the split,
  // which made `serializeRoutine` emit a document `parseRoutine` refused for 64
  // of the 192 storable `routine_sets` shapes — every cardio or stretch set
  // carrying `target_reps`.
  //
  // Nothing validates a set's fields against its parent exercise's kind:
  // `replaceRoutineSets` stores `target_reps` on a cardio row without complaint,
  // and `updateRoutineExerciseExerciseId` deliberately KEEPS reps across a
  // substitution, so re-pointing a rep-prescribed entry at an existing cardio
  // exercise produces exactly this row. A stretch prescribed in reps ("5 ×
  // cat-cow") is an ordinary plan, not an exotic one. Refusing to export a shape
  // the DB happily stores is the failure #262 keeps this parser alive to catch.
  //
  // In a routine the slot is `1x<reps>` — one prescribed set — so there is no
  // multi-set plan to misread here; `3x8` is still refused above by the
  // routine-only sets-slot rule. In a SESSION the slot means logged reps, which
  // a cardio measurement genuinely cannot have, so the prohibition stays.
  if (
    (kind === 'cardio' || kind === 'stretch') &&
    (setsSlot !== undefined || targetReps !== undefined)
  ) {
    throw new ContractError(`${kind} exercise cannot have sets×reps: ${line}`);
  }

  if (kind === 'strength' && targetReps === undefined && parsedFlags.durationSeconds === undefined) {
    // `setsSlot` is not tested alongside: the sets slot sets both numbers or
    // neither, so `targetReps === undefined` already means "no sets slot".
    throw new ContractError(`Strength exercise missing sets×reps: ${line}`);
  }

  return workoutLine;
}

/**
 * The routine tail: decide whether this line IS a prescribed set or is the
 * entry saying it has none, and refuse anything that is neither (#293 review).
 *
 * A routine line is one prescribed set, and every field of that set is
 * independently optional — all five `routine_sets` columns are nullable, so
 * `- bench-press-db: target_weight=50` is a real prescription and used to
 * vanish, read as an exercise line instead. The only line that is NOT a set is
 * the one that says `sets=0`.
 *
 * Two things are still refused, both because the alternative is a silent
 * misread of an author's plan:
 * - a stray token on a line that prescribes no reps and no duration — `4x`,
 *   neither a sets slot nor a `key=value` nor a `@hint`, which
 *   `parseFlagTokens` skips as an "unknown non-flag". A typo'd sets slot must
 *   not launder into a set that prescribes nothing. The condition is
 *   reps-or-duration, the same width it had before this phase, and NOT the
 *   `prescribed` list this function's other rule uses — see the note at the
 *   check itself for why the tidier-looking consistency is the weaker rule. A
 *   stray token on a line that does prescribe reps or a duration is still
 *   ignored — that relaxation predates #276 in both documents, and narrowing it
 *   would break the #277 legacy-tokenizer fixtures, whose whole point is that a
 *   multi-token note truncates rather than throwing.
 * - a `sets=0` line that also carries set content, which asserts both that the
 *   entry has no sets and that here is one of them.
 */
function finishRoutineLine(
  line: string,
  workoutLine: WorkoutLine,
  flagParts: string[],
  noSets: boolean
): WorkoutLine {
  const prescribed = SET_LEVEL_FIELDS.filter((field) => workoutLine[field] !== undefined);

  // Deliberately reps-or-duration, NOT `prescribed.length === 0` (M8, #293
  // review round 2). The two differ on exactly four lines — `target_weight=50
  // 4x`, `reps_max=10 4x`, `set_type=warmup 4x`, `target_distance=100 4x` —
  // which the wider condition reads as "already prescribes something" and so
  // silently swallows the typo'd sets slot on.
  //
  // Both widths pass the whole suite, so this is a choice, not a necessity, and
  // it is recorded as one. The narrow test keeps `4x` loud on four more shapes,
  // which is the entire point of the rule; matching `prescribed` would have
  // been a tidier consistency argument and strictly less protective. Only
  // making the guard UNCONDITIONAL is actually forced against — that breaks the
  // five #277 legacy-tokenizer fixtures, whose point is that a multi-token note
  // truncates rather than throwing.
  const hasSetContent =
    workoutLine.targetReps !== undefined || workoutLine.targetDurationSeconds !== undefined;

  if (!hasSetContent) {
    const strayTokens = flagParts.filter(
      (part) => !part.startsWith('@') && !part.includes('=')
    );
    if (strayTokens.length > 0) {
      throw new ContractError(
        `Unrecognized token${strayTokens.length > 1 ? 's' : ''} ` +
          `${strayTokens.join(', ')} in line: ${line}`
      );
    }
  }

  if (!noSets) return workoutLine;

  if (prescribed.length > 0) {
    throw new ContractError(
      `sets=0 says the entry prescribes no sets, but the line also prescribes ` +
        `${prescribed.join(', ')}: ${line}`
    );
  }

  return {
    exerciseId: workoutLine.exerciseId,
    kind: workoutLine.kind,
    sets: [],
    restSeconds: workoutLine.restSeconds,
    supersetLabel: workoutLine.supersetLabel,
    hint: workoutLine.hint,
  };
}

/**
 * What a routine line says about ONE set, as opposed to about its entry. A
 * `sets=0` line may carry the entry-level flags (rest, superset, hint, kind)
 * and none of these.
 */
const SET_LEVEL_FIELDS = [
  'setsSlot',
  'targetReps',
  'targetRepsMax',
  'targetWeightKg',
  'targetDurationSeconds',
  'targetDistanceM',
  'setRestSeconds',
  'setType',
] as const satisfies readonly (keyof WorkoutLine)[];

/**
 * Fold one parsed routine line into the prescribed set it describes.
 *
 * The set's own vocabulary is `RoutineSetType`'s {warmup, normal}, narrower
 * than the line grammar's `set_type` values. `serializeRoutine` only ever
 * writes `warmup` or nothing, so the mapping is total in the direction that
 * matters; a hand-authored `set_type=working` (or `drop`, which the grammar
 * admits and the routine model has no room for) reads as `normal`.
 */
function toRoutineSet(line: WorkoutLine): RoutineSetLine {
  const set: RoutineSetLine = {
    setType: line.setType === 'warmup' ? 'warmup' : 'normal',
  };
  if (line.targetReps !== undefined) set.targetReps = line.targetReps;
  if (line.targetRepsMax !== undefined) set.targetRepsMax = line.targetRepsMax;
  if (line.targetWeightKg !== undefined) set.targetWeightKg = line.targetWeightKg;
  if (line.targetDurationSeconds !== undefined)
    set.targetDurationSeconds = line.targetDurationSeconds;
  if (line.targetDistanceM !== undefined) set.targetDistanceM = line.targetDistanceM;
  if (line.setRestSeconds !== undefined) set.restSeconds = line.setRestSeconds;
  return set;
}

/**
 * The entry-level flags a run of set lines must agree on.
 *
 * `supersetLabel` is a member that can never fire, and is kept deliberately
 * (P35, #293 review round 2, confirmed a provably equivalent mutant — removing
 * it changes no behavior). Label equality is already half of `continuesEntry`
 * below, so two lines that disagree on it never reach the conflict check at
 * all; they are two entries, not one entry contradicting itself.
 *
 * It stays because the list reads as "the entry-level flags", and a reader who
 * finds the label missing has to re-derive that it is enforced elsewhere. If
 * `continuesEntry` is ever narrowed to the exercise id alone, this member
 * becomes live and load-bearing on its own — which is the second reason not to
 * delete it as dead weight.
 */
const ENTRY_FLAGS = ['restSeconds', 'supersetLabel', 'hint', 'kind'] as const;

/**
 * Group a run of consecutive routine lines naming the same exercise into one
 * entry whose `sets` is the ordered prescription (#276 Phase 5, AC5.2).
 *
 * Keyed on the exercise id AND the superset label. The label is part of the key
 * rather than merely carried along, because a set list must never straddle a
 * superset boundary: `groupSupersets` below runs on the OUTPUT of this and
 * groups by adjacency of label, and the engine's own contiguity premise
 * (`helpers.lv`'s `group_end_idx`, cited by `transition.lv`) rests on that
 * grouping being honest.
 *
 * An entry-level flag that DISAGREES across the run is a contract violation
 * rather than a first-wins merge. The serializer writes rest, hint, kind and
 * superset identically on every line of an entry, so a disagreement means the
 * document is describing two entries this grouping cannot tell apart — and
 * quietly keeping the first line's value would discard the second's.
 *
 * The limit, stated because it is a real one: two ADJACENT entries of the same
 * exercise with identical entry-level flags are indistinguishable from one
 * entry with the combined sets, and merge. A routine may legitimately list the
 * same exercise twice (AGENTS.md, Boundaries), so this is a lossy corner of the
 * grammar — inherent to "group by exercise id", which is what AC5.2 specifies.
 * It is not reachable from any production path today: nothing outside tests
 * calls `parseRoutine` (#262).
 */
function groupRoutineSets(lines: WorkoutLine[]): WorkoutLine[] {
  const result: WorkoutLine[] = [];

  for (const line of lines) {
    const previous = result[result.length - 1];
    const continuesEntry =
      previous !== undefined &&
      previous.exerciseId === line.exerciseId &&
      previous.supersetLabel === line.supersetLabel;

    if (!continuesEntry) {
      const { setsSlot, targetReps, targetDurationSeconds, targetRepsMax, targetWeightKg, targetDistanceM, setRestSeconds, setType, ...entry } = line;
      result.push({ ...entry, sets: line.sets ?? [toRoutineSet(line)] });
      continue;
    }

    for (const flag of ENTRY_FLAGS) {
      if (previous[flag] !== line[flag]) {
        throw new ContractError(
          `Conflicting ${flag} across the set lines of ${line.exerciseId}: ` +
            `${String(previous[flag])} then ${String(line[flag])}`
        );
      }
    }

    // A `sets=0` line inside a run contributes no set, and neither does the run
    // contribute one to it: `sets: []` on either side simply appends nothing.
    // That keeps `- ex: sets=0` followed by `- ex: 1x5` from inventing a
    // phantom set, without needing a special case.
    previous.sets = [...(previous.sets ?? []), ...(line.sets ?? [toRoutineSet(line)])];
  }

  return result;
}

/**
 * Group adjacent lines with the same superset label.
 * Non-adjacent lines with the same label are NOT grouped.
 *
 * This is the fifth superset-contiguity walk in the codebase and the one #278
 * deliberately left out of its consolidation: its singleton-label dropping is
 * part of the markdown contract that `helpers.lv:56` and `transition.lv:14`
 * cite by name, so it is a named exception rather than an oversight.
 *
 * #276 Phase 5 does not change it, and does not change its premise. What runs
 * through it changed shape — for a routine it now receives one item per ENTRY
 * rather than one per line, because `groupRoutineSets` has already folded each
 * entry's set lines together — but adjacency and label equality are still what
 * decide a group, and `groupRoutineSets` keys on the label precisely so it can
 * never merge across one. For a session nothing changed at all: session lines
 * are not folded, so this still sees exactly what it always did.
 */
function groupSupersets(lines: WorkoutLine[]): (WorkoutLine | SupersetGroup)[] {
  const result: (WorkoutLine | SupersetGroup)[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];

    if (!current.supersetLabel) {
      result.push(current);
      i++;
      continue;
    }

    // Found a superset; collect all adjacent lines with the same label
    const supersetLabel = current.supersetLabel;
    const group: WorkoutLine[] = [current];
    i++;

    while (i < lines.length && lines[i].supersetLabel === supersetLabel) {
      group.push(lines[i]);
      i++;
    }

    // Add as a group if it has > 1 line, else as single exercises
    if (group.length > 1) {
      result.push({ exercises: group, supersetLabel });
    } else {
      result.push(...group);
    }
  }

  return result;
}

/**
 * Internal implementation: parse markdown with context-dependent validation.
 *
 * @param context - 'routine' for author-written targets, 'session' for logged
 *   measurements. See `parseWorkoutLine` for the three places it is consulted.
 */
function parseDoc(markdown: string, context: DocContext): ParsedDoc {
  try {
    const frontmatter = parseFrontmatter(markdown);
    const blockContent = extractWorkoutBlock(markdown);

    const lines: string[] = blockContent.split('\n').filter(line => line.trim());

    // Parse each line
    const workoutLines: WorkoutLine[] = [];
    for (const line of lines) {
      const parsed = parseWorkoutLine(line, context);
      if (parsed) {
        workoutLines.push(parsed);
      }
    }

    // A routine's lines are SETS; fold each entry's run back together before
    // the superset walk, which works in entries. A session's lines are already
    // one per logged set and are not folded — `parseSession` surfaces them
    // individually under `loggedReps`.
    const entries = context === 'routine' ? groupRoutineSets(workoutLines) : workoutLines;

    // Group supersets
    const exercises = groupSupersets(entries);

    return { frontmatter, exercises };
  } catch (error) {
    if (error instanceof ContractError) {
      throw error;
    }
    throw new ContractError(`Failed to parse: ${(error as any).message}`);
  }
}

/**
 * Parse routine markdown.
 */
export function parseRoutine(markdown: string): ParsedDoc {
  return parseDoc(markdown, 'routine');
}

/**
 * Parse session markdown.
 */
export function parseSession(markdown: string): ParsedDoc {
  // Sessions share the routine line grammar, but the sets×reps slot carries
  // LOGGED values ("1x<logged reps>"), not routine targets (see format.ts).
  // Surface them under honest names so consumers (e.g. the Phase 7 sync
  // client) never read a logged rep count out of `targetReps`.
  const doc = parseDoc(markdown, 'session');
  const withLoggedFields = (line: WorkoutLine): WorkoutLine => ({
    ...line,
    loggedReps: line.targetReps,
    loggedDurationSeconds: line.targetDurationSeconds,
  });
  return {
    ...doc,
    exercises: doc.exercises.map((entry) =>
      'exercises' in entry
        ? { ...entry, exercises: entry.exercises.map(withLoggedFields) }
        : withLoggedFields(entry)
    ),
  };
}
