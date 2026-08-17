/**
 * Interop format contract: types and shared parsing/formatting for serializer/parser.
 * Single source of truth to prevent drift between serializer and parser.
 *
 * SCOPE: Line-level tokenization and flag parsing (rest, superset, kind,
 * duration, set_type, @hint, plus rpe/weight/distance on a session line and
 * reps_max/target_weight/target_distance on a routine line).
 * Document-level frontmatter/block validation is in workout-bridge/src/contract.ts.
 * Both files share parseDuration() and ContractError — keep identical.
 *
 * THE LINE SHAPE, IN BOTH DOCUMENTS (#276 Phase 5):
 *
 *     - <exercise-id>: [1x<reps>] [flags…]
 *
 * One line is one set. A routine prescribes them, a session records them, and
 * a run of consecutive routine lines naming the same exercise is one entry:
 *
 *     - bench-press-db: 1x5 rest=2:00 set_type=warmup target_weight=9.07
 *     - bench-press-db: 1x5 rest=2:00 set_type=warmup target_weight=11.34
 *     - bench-press-db: 1x3 rest=2:00 set_type=warmup target_weight=18.14
 *     - bench-press-db: 1x8 rest=2:00 reps_max=10 target_weight=22.68
 *
 * A routine line with no set content at all (`- bench-press-db:`) is an
 * exercise the routine names and prescribes nothing for — a real shape the DB
 * can hold, so the grammar has to be able to say it.
 */

import { SetType } from '@/db/models/SessionSet';
import type { RoutineSetType } from '@/db/models/RoutineSet';
import { ExerciseKind } from '@/db/models/Exercise';

export type { RoutineSetType };

/**
 * Set types the markdown grammar accepts: everything the app writes, plus
 * 'drop' — the app never writes it, but it stays legal in hand-authored
 * vault files.
 */
export type MarkdownSetType = SetType | 'drop';

/**
 * Which document a line belongs to. Consulted by the flag allowlist, by the
 * sets slot, and by whether a line with no set content is legal — see
 * `parse.ts`.
 */
export type DocContext = 'routine' | 'session';

/**
 * ONE PRESCRIBED SET of a routine entry (#276 Phase 5).
 *
 * Mirrors `RoutineSetEntry` (`src/db/repository.ts`) field for field, minus the
 * things a routine_sets row does not have: the grammar's own set list IS the
 * `order`, and identity lives on the exercise line's `- <exercise-id>:` slot.
 * The kg here is canonical storage, exactly as in the column — the lbs the
 * coach speaks are converted once, at the AI accept boundary, and never here.
 */
export interface RoutineSetLine {
  setType: RoutineSetType;
  targetReps?: number;
  targetRepsMax?: number;
  targetWeightKg?: number;
  targetDurationSeconds?: number;
  targetDistanceM?: number;
}

/**
 * A single line in a workout block (before grouping).
 * Represents one line: `- <exercise-id>: [1x<reps>] [flags…]`
 *
 * ONE LINE IS ONE SET, in both documents (#276 Phase 5). The sets slot's first
 * number is therefore always `1`, and the second carries:
 * - in a ROUTINE, the set's *target* reps — `parseRoutine` then folds a run of
 *   consecutive same-exercise lines into one entry whose `sets` is the ordered
 *   list, and the per-set fields below belong to that fold, not to the entry;
 * - in a SESSION, the *logged* reps, surfaced under the honest `loggedReps`
 *   alias by `parseSession`.
 *
 * The `<target-sets>x<target-reps>` routine overload this slot used to carry is
 * GONE. It was the source of the grammar's one context-dependent validation
 * rule (`3x0` refused in a routine, `1x0` accepted in a session), and of a
 * model that could not express a warmup ramp at all: three warmups at three
 * weights collapsed to the number 3 and the weights were unrecoverable.
 */
export interface WorkoutLine {
  exerciseId: string;
  // Session lines: the `1x<logged-reps>` slot, before parseSession renames it.
  // A routine line leaves these unset and fills `sets` instead.
  targetSets?: number;
  targetReps?: number;
  // Session lines: duration instead of reps (kind=cardio|stretch).
  targetDurationSeconds?: number;
  // Routine lines: the ordered prescribed sets of this entry, assembled by
  // `parseRoutine` from a run of consecutive lines. `[]` is a real answer — an
  // exercise the routine names but prescribes nothing for (convention 10).
  sets?: RoutineSetLine[];
  // Flags
  restSeconds?: number;
  supersetLabel?: string;
  kind: ExerciseKind;
  hint?: string;
  // Session sets only (not in routine)
  rpe?: number;
  weight?: number; // logged weight in kg, session sets only
  distance?: number; // logged distance in m, session sets only (cardio)
  // Routine sets only (not in a session): the per-set prescription, read off
  // this one line and folded into the entry's `sets` by `parseRoutine`.
  targetRepsMax?: number;
  targetWeightKg?: number;
  targetDistanceM?: number;
  // Logged session: actual set type
  setType?: MarkdownSetType;
  // Session lines only: honest aliases populated by parseSession — the
  // sets×reps slot in a session line carries LOGGED values ("1x<logged reps>"),
  // so consumers should read these instead of the target* fields.
  loggedReps?: number;
  loggedDurationSeconds?: number;
}

/**
 * A group of exercises that share a superset label.
 * Adjacent lines with the same `superset=<label>` collapse into one group.
 */
export interface SupersetGroup {
  exercises: WorkoutLine[];
  supersetLabel: string;
}

/**
 * Parsed routine or session: frontmatter + structured workout lines.
 */
export interface ParsedDoc {
  frontmatter: Record<string, string>;
  exercises: (WorkoutLine | SupersetGroup)[];
}

/**
 * Typed routine doc: frontmatter keys + structured exercises.
 */
export interface RoutineDoc {
  type: 'workout-routine';
  id: string;
  updated: string; // ISO date
  tags: string[];
  created: string; // ISO date
  exercises: (WorkoutLine | SupersetGroup)[];
}

/**
 * Typed session doc: frontmatter keys + structured exercises + Tasks-plugin metadata.
 */
export interface SessionDoc {
  type: 'workout-session';
  id: string;
  date: string; // ISO date (completed date)
  tags: string[];
  created: string; // ISO date
  completedAt?: string; // ISO date of completion
  exercises: (WorkoutLine | SupersetGroup)[];
}

/**
 * Parsed flags from a single line.
 * All fields are optional; defaults filled by parser/serializer context.
 */
export interface ParsedFlags {
  restSeconds?: number;
  supersetLabel?: string;
  kind?: ExerciseKind;
  duration?: string; // m:ss format
  durationSeconds?: number;
  hint?: string;
  rpe?: number;
  setType?: MarkdownSetType;
  weight?: number; // kg, session sets only
  distance?: number; // m, session sets only (cardio)
  targetRepsMax?: number; // routine sets only: the top of a rep range
  targetWeightKg?: number; // kg, routine sets only: the prescribed load
  targetDistanceM?: number; // m, routine sets only
}

/**
 * The RPE scale the grammar admits: 1–10 inclusive, in exact 0.5 steps (#284).
 *
 * **This is the one place the bound is stated, and both halves read it.** The
 * reader (`parseSingleFlag`) enforced the scale while the writer
 * (`formatFlags`) enforced nothing, so a stored `rpe: 0` was emitted as
 * `rpe=0` and then refused by `parseSession` — the serializer producing a
 * document the parser rejects, which is exactly the drift `parse.ts` is kept
 * alive to prevent (#262). Restating the bound at the writer would have
 * reproduced the same hazard one fix later; a shared predicate cannot drift
 * from itself.
 *
 * Why 0 is *not* the `reps: 0` case, which went the other way (PR #89): a set
 * logged with zero reps is a real measurement, so the grammar carries it. RPE
 * 0 is not a measurement — nothing in the app produces it and nothing means
 * it. The app's own scale starts at 1 (`RPE_MIN`, `src/state/rpe.ts`), and its
 * input path already reads a 0 off the slider as *cleared* rather than as an
 * effort rating (`buildLogSetValues`, `src/state/setInputs.ts`). So a 0 that
 * somehow reaches the serializer means "absent", and is written as absent.
 *
 * Out-of-scale values are dropped, not thrown on: RPE is an optional
 * annotation, and `serializeSession` is all-or-nothing at *set* granularity
 * (a set it cannot identify throws). Failing a whole session document — and
 * with it a whole session's export, via `exportSessionHistory`'s `failures` —
 * over one unusable annotation is the disproportionate outcome, not the safe
 * one. The set's actual work still serializes.
 *
 * The same 1–10/0.5 rule is enforced independently upstream by `validate_set`
 * (`src/engine/rules/helpers.lv`), `validateSet` (`src/db/validation.ts`) and
 * the slider's `snapRpe` (`src/state/rpe.ts`). Those are the write path's own
 * guards and are why a real `session_sets` row cannot hold a 0 today; this one
 * is the grammar's, and owes them nothing.
 */
const RPE_MIN = 1;
const RPE_MAX = 10;

/**
 * Is `value` a legal RPE on the wire? Used by both halves of the contract —
 * `formatFlags` will not write one that fails, `parseSingleFlag` will not read
 * one that fails.
 */
export function isValidRpe(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < RPE_MIN || value > RPE_MAX) return false;
  return (value * 2) % 1 === 0;
}

/**
 * Parse duration string (m:ss or mm:ss) to seconds.
 * Examples: "5:00" -> 300, "0:30" -> 30, "1:30" -> 90
 */
export function parseDuration(durationStr: string): number | null {
  const match = durationStr.match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  if (seconds > 59) return null;
  return minutes * 60 + seconds;
}

/**
 * Format seconds to duration string (m:ss).
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Quoted flag values (#277).
 *
 * A flag value is one whitespace-delimited token, which meant a free-text value
 * — `@<hint>` (a routine exercise's notes) or `superset=<label>` — could hold
 * exactly one word. A prose note lost everything after its first word silently,
 * and a note containing `=` threw as an unknown flag key.
 *
 * The grammar therefore allows a value to be **double-quoted**, and a quoted
 * value may contain whitespace, `=`, `@`, and escapes. Quoting is applied by
 * the serializer only when the value needs it (`quoteFlagValue`), so a value
 * that was previously emitted bare is still emitted bare, byte for byte.
 *
 * On the *reading* side the compatibility is near-total but NOT absolute, and
 * the exception is deliberate. `"` opens a quoted value only in value-opening
 * position (`opensQuotedValue`), so a `"` appearing mid-value — an inch mark
 * like `@Go 2" deep` — stays literal and the value still tokenizes on
 * whitespace exactly as it did before. What changes is a value that *opens*
 * with a quote: `@"squeeze at the top" - coach` used to parse as `"squeeze`
 * and now yields the whole phrase, and its unbalanced sibling
 * `@"squeeze at the top - coach` now raises a contract violation where it
 * used to truncate. Closing that gap would mean relaxing `decodeFlagValue`'s
 * unterminated-quote check, which is the second half of a defence-in-depth
 * pair, in exchange for a note shape far rarer than an inch mark — so the
 * trade was refused and the exception is recorded here instead.
 *
 * Do not restate this as "every prior document parses identically". That
 * absolute was written once, was false, and the review that caught it (#277,
 * round 1) found it recorded in AGENTS.md as settled fact.
 *
 * Escapes inside a quoted value: `\\` `\"` `\n` `\r`. Anything else after a
 * backslash is a contract violation rather than a silent literal.
 *
 * **Newlines round-trip; they are not normalized to spaces.** A note copied out
 * of another app can be multi-line, and `\n` inside a quoted value carries that
 * across without a literal newline ever appearing in a workout line — the
 * document stays line-based.
 */
const QUOTE = '"';

/** Values containing these must be quoted to survive tokenization. */
function needsQuoting(value: string): boolean {
  return value === '' || /[\s"\\]/.test(value);
}

/**
 * Format a free-text flag value for the wire: bare when it survives
 * tokenization as-is, double-quoted with escapes when it does not.
 */
export function quoteFlagValue(value: string): string {
  if (!needsQuoting(value)) return value;

  let escaped = '';
  for (const ch of value) {
    if (ch === '\\') escaped += '\\\\';
    else if (ch === QUOTE) escaped += '\\"';
    else if (ch === '\n') escaped += '\\n';
    else if (ch === '\r') escaped += '\\r';
    else escaped += ch;
  }
  return `${QUOTE}${escaped}${QUOTE}`;
}

/**
 * Decode a flag value read off the wire. A quoted value is unquoted and its
 * escapes resolved; a bare value is returned unchanged.
 *
 * Throws `ContractError` on an unterminated quote or an unrecognized escape —
 * both are the serializer having written something it never writes, so they are
 * contract violations rather than recoverable text.
 */
export function decodeFlagValue(raw: string): string {
  if (!raw.startsWith(QUOTE)) return raw;
  if (raw.length < 2 || !raw.endsWith(QUOTE)) {
    throw new ContractError(`Unterminated quoted value: ${raw}`);
  }

  const body = raw.slice(1, -1);
  let decoded = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      decoded += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === '\\') decoded += '\\';
    else if (next === QUOTE) decoded += QUOTE;
    else if (next === 'n') decoded += '\n';
    else if (next === 'r') decoded += '\r';
    else throw new ContractError(`Unrecognized escape in quoted value: \\${next ?? ''} (in ${raw})`);
    i++;
  }
  return decoded;
}

/**
 * Is a quote arriving here opening a value, given the token built so far?
 *
 * There is exactly one such position per token, and it is the only place the
 * serializer ever writes an opening quote: straight after the `@` that
 * introduces a hint, or straight after the *first* `=` of a `key=value` flag.
 * A quote anywhere else is an ordinary character.
 *
 * That restriction is what keeps pre-#277 documents readable (#277 review, C2).
 * A quote toggling on sight made an inch mark — `@Go 2" deep`, `@Use the 45"
 * band`, entirely ordinary in a lifting note — swallow the rest of the line and
 * throw `Unterminated quoted value`, where the old whitespace tokenizer had
 * merely truncated at the first space. Truncating is the documented old
 * behaviour; refusing the whole document is a regression, and `"` only became
 * significant at all in this change.
 *
 * Both clauses are load-bearing:
 * - `current === '@'` — only a *leading* `@`, so `@see @coach` does not reopen.
 * - the `=` clause requires it to be the token's first `=` and the token not to
 *   be a hint, so a note whose own text contains `=` before a quote
 *   (`@tempo="3010`) is left alone rather than reparsed as a quoted flag value.
 */
function opensQuotedValue(current: string): boolean {
  if (current === '@') return true;
  if (current.startsWith('@')) return false;
  return current.endsWith('=') && current.indexOf('=') === current.length - 1;
}

/**
 * Split a flag string into tokens, respecting double-quoted values.
 *
 * This is the tokenizer for a whole line's spec, not just its flags: `parse.ts`
 * uses it before it looks for the `<sets>x<reps>` slot, so a quoted value
 * containing something like `3x12` is never mistaken for the sets slot.
 *
 * A `"` is a delimiter only in value-opening position (`opensQuotedValue`) or
 * as the closer of a value opened there; everywhere else it is literal text.
 *
 * Tokens keep their quotes; `decodeFlagValue` strips them at the point the
 * value's meaning is known. Throws `ContractError` on an unterminated quote —
 * the first of two layers, the decoder being the second.
 */
export function tokenizeFlagString(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes && ch === '\\') {
      // Keep the escape pair raw; decodeFlagValue resolves it later.
      current += ch + (input[i + 1] ?? '');
      i++;
      continue;
    }

    if (ch === QUOTE && (inQuotes || opensQuotedValue(current))) {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }

    if (!inQuotes && /\s/.test(ch)) {
      // `current !== ''` rather than a separate `started` flag: every branch
      // above appends at least one character, so a non-empty `current` is
      // exactly "a token is open".
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (inQuotes) {
    throw new ContractError(`Unterminated quoted value in: ${input}`);
  }
  if (current !== '') tokens.push(current);

  return tokens;
}

/**
 * Parse a single `key=value` flag: rest=<sec|m:ss>, warmup=<n>,
 * superset=<label>, kind=<type>, duration=<m:ss>, rpe=<n>, …
 *
 * Hints are NOT handled here: `parseFlagTokens` recognizes `@<hint>` and
 * `continue`s before it ever dispatches to this function, so the `@` branch
 * this used to carry was unreachable — a mutation of it changed nothing, which
 * is how it was found (#277). Any future caller must keep that order.
 */
function parseSingleFlag(flag: string): [key: string, value: any] | null {
  const eqIndex = flag.indexOf('=');
  if (eqIndex === -1) return null;

  const key = flag.substring(0, eqIndex);
  const valueStr = decodeFlagValue(flag.substring(eqIndex + 1));

  switch (key) {
    case 'rest': {
      // Parse rest as seconds or m:ss
      if (valueStr.includes(':')) {
        const seconds = parseDuration(valueStr);
        return seconds !== null ? ['restSeconds', seconds] : null;
      }
      const sec = parseInt(valueStr, 10);
      return !isNaN(sec) && sec >= 0 ? ['restSeconds', sec] : null;
    }

    case 'superset':
      return ['supersetLabel', valueStr];

    case 'kind': {
      const validKinds: ExerciseKind[] = ['strength', 'cardio', 'stretch'];
      return validKinds.includes(valueStr as ExerciseKind)
        ? ['kind', valueStr as ExerciseKind]
        : null;
    }

    case 'duration': {
      const seconds = parseDuration(valueStr);
      return seconds !== null
        ? ['durationSeconds', seconds]
        : null;
    }

    case 'rpe': {
      // The scale lives in `isValidRpe`, shared with `formatFlags` (#284).
      const rpe = parseFloat(valueStr);
      return isValidRpe(rpe) ? ['rpe', rpe] : null;
    }

    case 'set_type': {
      const validTypes: MarkdownSetType[] = ['warmup', 'working', 'drop', 'stretch', 'cardio'];
      return validTypes.includes(valueStr as MarkdownSetType)
        ? ['setType', valueStr as MarkdownSetType]
        : null;
    }

    case 'weight': {
      // 0 is valid: bodyweight sets persist weight_kg = 0 (db validation rejects only < 0)
      const kg = parseFloat(valueStr);
      return !isNaN(kg) && kg >= 0 ? ['weight', kg] : null;
    }

    case 'distance': {
      const m = parseFloat(valueStr);
      return !isNaN(m) && m >= 0 ? ['distance', m] : null;
    }

    // The routine-side trio (#276 Phase 5). Deliberately NOT spelled `weight=`
    // and `distance=`: those already mean LOGGED kilograms and metres on a
    // session line, and one key meaning "what happened" in one document and
    // "what is planned" in the other is the confusion this grammar change
    // exists to remove. Which document each key is legal in is enforced by the
    // allowlist in `parseFlagTokens`, not here.
    case 'reps_max': {
      const n = parseInt(valueStr, 10);
      return !isNaN(n) && n >= 0 ? ['targetRepsMax', n] : null;
    }

    case 'target_weight': {
      // 0 is valid for the same reason `weight=` accepts it: a bodyweight
      // exercise can be prescribed with an explicit zero load.
      const kg = parseFloat(valueStr);
      return !isNaN(kg) && kg >= 0 ? ['targetWeightKg', kg] : null;
    }

    case 'target_distance': {
      const m = parseFloat(valueStr);
      return !isNaN(m) && m >= 0 ? ['targetDistanceM', m] : null;
    }

    default:
      return null;
  }
}

/**
 * Which flag keys each document admits (#276 Phase 5, AC5.3).
 *
 * The allowlist used to be one global list, and AGENTS.md recorded the
 * consequence as a known hole: "the 'session sets only' restriction on
 * `weight=` is a comment, not a rule … a routine line carrying `weight=60`
 * parses cleanly today." Splitting it makes the comment a rule.
 *
 * The split is not cosmetic. `weight=` (logged kg) and `target_weight=`
 * (prescribed kg) are different quantities that would otherwise be
 * interchangeable on the wire, and a routine that acquired a `weight=` would
 * read as a *measurement* to anything downstream.
 *
 * Shared keys are the ones that describe the exercise or the plan rather than
 * the measurement: `rest`, `superset`, `kind`, `duration`, `set_type`, and the
 * `@hint` (which is not a key at all and never reaches here).
 */
const SHARED_FLAGS = ['rest', 'superset', 'kind', 'duration', 'set_type'] as const;
const SESSION_ONLY_FLAGS = ['rpe', 'weight', 'distance'] as const;
const ROUTINE_ONLY_FLAGS = ['reps_max', 'target_weight', 'target_distance'] as const;

const KNOWN_FLAGS: Record<DocContext, readonly string[]> = {
  routine: [...SHARED_FLAGS, ...ROUTINE_ONLY_FLAGS],
  session: [...SHARED_FLAGS, ...SESSION_ONLY_FLAGS],
};

/**
 * Parse all flags from a line (space-separated).
 * Returns an object with parsed flags; throws on invalid flag values.
 */
export function parseFlags(flagStr: string, context: DocContext): ParsedFlags {
  return parseFlagTokens(tokenizeFlagString(flagStr), context);
}

/**
 * Parse flags from tokens already produced by `tokenizeFlagString`.
 *
 * This exists for callers that must tokenize the whole line themselves —
 * `parse.ts` has to find the `<sets>x<reps>` slot among the tokens before it
 * parses flags. Passing tokens is the direct route, not a correctness
 * requirement: re-joining and re-tokenizing is the identity on tokenizer output
 * (see the note at the `parseFlagTokens` call in `parse.ts`), so this and
 * `parseFlags` agree.
 */
export function parseFlagTokens(parts: string[], context: DocContext): ParsedFlags {
  const flags: ParsedFlags = {};

  for (const part of parts) {
    if (!part) continue;

    // Check if it's a known flag or hint
    if (part.startsWith('@')) {
      // Hint - always valid
      flags.hint = decodeFlagValue(part.substring(1));
      continue;
    }

    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      // Unknown non-flag; skip it
      continue;
    }

    const key = part.substring(0, eqIndex);
    const valueStr = part.substring(eqIndex + 1);

    // Known flags - throw on invalid value or unknown key IN THIS DOCUMENT.
    // A key legal in the other document is refused here by the same error: it
    // is not "unknown" in the abstract, but it is not something this document
    // may say, and letting it through is how `weight=` leaked onto a routine
    // line for as long as the allowlist was global.
    if (!KNOWN_FLAGS[context].includes(key)) {
      // Unknown flag key - throw per I1
      throw new ContractError(`Unknown flag key: ${key} (in ${part}) for a ${context} line`);
    }

    const result = parseSingleFlag(part);
    if (!result) {
      throw new ContractError(`Invalid flag value: ${part}`);
    }

    const [resultKey, value] = result;
    (flags as any)[resultKey] = value;
  }

  return flags;
}

/**
 * Format parsed flags back to a string (space-separated).
 * Only includes non-undefined values.
 */
export function formatFlags(flags: ParsedFlags): string {
  const parts: string[] = [];

  if (flags.restSeconds !== undefined) {
    if (flags.restSeconds >= 60) {
      parts.push(`rest=${formatDuration(flags.restSeconds)}`);
    } else {
      parts.push(`rest=${flags.restSeconds}`);
    }
  }

  if (flags.supersetLabel !== undefined) {
    // Quoted when it needs it (#277): a label is free text too, and the
    // whitespace tokenizer truncated it the same way it truncated a hint.
    parts.push(`superset=${quoteFlagValue(flags.supersetLabel)}`);
  }

  if (flags.kind !== undefined && flags.kind !== 'strength') {
    parts.push(`kind=${flags.kind}`);
  }

  if (flags.durationSeconds !== undefined) {
    parts.push(`duration=${formatDuration(flags.durationSeconds)}`);
  }

  if (flags.setType !== undefined) {
    // Emitted whenever present, `working` included (#277). A session line
    // always states its set type — it is a measurement, not a plan default.
    //
    // A routine line sets this only for a WARMUP set (#276 Phase 5): the
    // routine vocabulary is `RoutineSetType`'s {warmup, normal}, and `normal`
    // is spelled by saying nothing, which keeps an ordinary working set's line
    // as short as it was under `4x6`. `serializeRoutine` is the one deciding
    // that; this formatter just writes what it is given.
    parts.push(`set_type=${flags.setType}`);
  }

  // The routine-side prescription (#276 Phase 5), before the session-side
  // measurements below so a line reads plan-then-record. Only one group is
  // ever populated: the allowlist refuses the other in each document.
  if (flags.targetRepsMax !== undefined) {
    parts.push(`reps_max=${flags.targetRepsMax}`);
  }

  if (flags.targetWeightKg !== undefined) {
    parts.push(`target_weight=${flags.targetWeightKg}`);
  }

  if (flags.targetDistanceM !== undefined) {
    parts.push(`target_distance=${flags.targetDistanceM}`);
  }

  // Only a value the reader accepts is ever written (#284). This is the
  // writer's half of the shared scale rule; see `isValidRpe` for why an
  // out-of-scale value — 0 above all — is dropped rather than emitted or
  // thrown on. The omission is scoped to this flag: every other flag on the
  // line, and the set's reps/weight/duration, are untouched.
  if (flags.rpe !== undefined && isValidRpe(flags.rpe)) {
    parts.push(`rpe=${flags.rpe}`);
  }

  if (flags.weight !== undefined) {
    parts.push(`weight=${flags.weight}`);
  }

  if (flags.distance !== undefined) {
    parts.push(`distance=${flags.distance}`);
  }

  if (flags.hint !== undefined) {
    // The hint carries a routine exercise's notes — prose, so quoting is the
    // common case rather than the exception (#277).
    parts.push(`@${quoteFlagValue(flags.hint)}`);
  }

  return parts.join(' ');
}

/**
 * Custom error for contract violations.
 */
export class ContractError extends Error {
  constructor(message: string) {
    super(`Contract violation: ${message}`);
    this.name = 'ContractError';
  }
}
