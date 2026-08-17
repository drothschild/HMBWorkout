/**
 * Interop format contract: types and shared parsing/formatting for serializer/parser.
 * Single source of truth to prevent drift between serializer and parser.
 *
 * SCOPE: Line-level tokenization and flag parsing (rest, warmup, superset, kind,
 * duration, rpe, set_type, weight, distance, @hint).
 * Document-level frontmatter/block validation is in workout-bridge/src/contract.ts.
 * Both files share parseDuration() and ContractError — keep identical.
 */

import { SetType } from '@/db/models/SessionSet';
import { ExerciseKind } from '@/db/models/Exercise';

/**
 * Set types the markdown grammar accepts: everything the app writes, plus
 * 'drop' — the app never writes it, but it stays legal in hand-authored
 * vault files.
 */
export type MarkdownSetType = SetType | 'drop';

/**
 * A single exercise line in a workout block (before grouping).
 * Represents one line: `- <exercise-id>: [<sets>x<reps>] [flags…]`
 *
 * NOTE (M2): Sets×reps overload for logged sessions:
 * - In routines: <sets>x<reps> means target sets and target reps (e.g. "4x6" = 4 sets, 6 reps each)
 * - In sessions: <sets>x<reps> is emitted as "1x<logged-reps>" (1 logged set, with actual rep count)
 *   The parser must interpret session lines accordingly: 1x<n> means 1 logged set with n reps.
 *   This overload is necessary to distinguish logged reps from routine targets on the same line.
 */
export interface WorkoutLine {
  exerciseId: string;
  // Strength exercises
  targetSets?: number;
  targetReps?: number;
  // Cardio/stretch (kind=cardio|stretch, duration instead of reps)
  targetDurationSeconds?: number;
  // Flags
  restSeconds?: number;
  warmupSets?: number;
  supersetLabel?: string;
  kind: ExerciseKind;
  hint?: string;
  // Session sets only (not in routine)
  rpe?: number;
  weight?: number; // logged weight in kg, session sets only
  distance?: number; // logged distance in m, session sets only (cardio)
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
  warmupSets?: number;
  supersetLabel?: string;
  kind?: ExerciseKind;
  duration?: string; // m:ss format
  durationSeconds?: number;
  hint?: string;
  rpe?: number;
  setType?: MarkdownSetType;
  weight?: number; // kg, session sets only
  distance?: number; // m, session sets only (cardio)
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
 * that was previously emitted bare is still emitted bare, byte for byte, and
 * every document written before this change parses exactly as it did.
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
 * Split a flag string into tokens, respecting double-quoted values.
 *
 * This is the tokenizer for a whole line's spec, not just its flags: `parse.ts`
 * uses it before it looks for the `<sets>x<reps>` slot, so a quoted value
 * containing something like `3x12` is never mistaken for the sets slot.
 *
 * Tokens keep their quotes; `decodeFlagValue` strips them at the point the
 * value's meaning is known. Throws `ContractError` on an unterminated quote.
 */
export function tokenizeFlagString(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes && ch === '\\') {
      // Keep the escape pair raw; decodeFlagValue resolves it later.
      current += ch + (input[i + 1] ?? '');
      i++;
      started = true;
      continue;
    }

    if (ch === QUOTE) {
      inQuotes = !inQuotes;
      current += ch;
      started = true;
      continue;
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }

    current += ch;
    started = true;
  }

  if (inQuotes) {
    throw new ContractError(`Unterminated quoted value in: ${input}`);
  }
  if (started) tokens.push(current);

  return tokens;
}

/**
 * Parse a single flag value.
 * Handles: rest=<sec|m:ss>, warmup=<n>, superset=<label>, kind=<type>, duration=<m:ss>, rpe=<n>, @<hint>
 */
function parseSingleFlag(flag: string): [key: string, value: any] | null {
  if (flag.startsWith('@')) {
    // Hint: @<text> or @"<text with spaces>"
    return ['hint', decodeFlagValue(flag.substring(1))];
  }

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

    case 'warmup': {
      const n = parseInt(valueStr, 10);
      return !isNaN(n) && n >= 0 ? ['warmupSets', n] : null;
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
      const rpe = parseFloat(valueStr);
      // RPE must be 1-10 in 0.5 steps
      if (isNaN(rpe) || rpe < 1 || rpe > 10) return null;
      // Check 0.5 step
      if ((rpe * 2) % 1 !== 0) return null;
      return ['rpe', rpe];
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

    default:
      return null;
  }
}

/**
 * Parse all flags from a line (space-separated).
 * Returns an object with parsed flags; throws on invalid flag values.
 */
export function parseFlags(flagStr: string): ParsedFlags {
  return parseFlagTokens(tokenizeFlagString(flagStr));
}

/**
 * Parse flags from tokens already produced by `tokenizeFlagString`.
 *
 * Callers that tokenize the whole line themselves (`parse.ts`, which must find
 * the `<sets>x<reps>` slot among the tokens) pass their tokens straight through
 * rather than re-joining them into a string — a quoted value's internal
 * whitespace must not be re-split.
 */
export function parseFlagTokens(parts: string[]): ParsedFlags {
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

    // Known flags - throw on invalid value or unknown key
    const knownFlags = ['rest', 'warmup', 'superset', 'kind', 'duration', 'rpe', 'set_type', 'weight', 'distance'];
    if (!knownFlags.includes(key)) {
      // Unknown flag key - throw per I1
      throw new ContractError(`Unknown flag key: ${key} (in ${part})`);
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

  if (flags.warmupSets !== undefined && flags.warmupSets > 0) {
    parts.push(`warmup=${flags.warmupSets}`);
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

  if (flags.setType !== undefined && flags.setType !== 'working') {
    parts.push(`set_type=${flags.setType}`);
  }

  if (flags.rpe !== undefined) {
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
