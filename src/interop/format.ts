/**
 * Interop format contract: types and shared parsing/formatting for serializer/parser.
 * Single source of truth to prevent drift between serializer and parser.
 *
 * SCOPE: Line-level flag parsing (rest, warmup, superset, kind, duration, rpe, set_type, weight, distance).
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
 * Parse a single flag value.
 * Handles: rest=<sec|m:ss>, warmup=<n>, superset=<label>, kind=<type>, duration=<m:ss>, rpe=<n>, @<hint>
 */
function parseSingleFlag(flag: string): [key: string, value: any] | null {
  if (flag.startsWith('@')) {
    // Hint: @<text>
    return ['hint', flag.substring(1)];
  }

  const eqIndex = flag.indexOf('=');
  if (eqIndex === -1) return null;

  const key = flag.substring(0, eqIndex);
  const valueStr = flag.substring(eqIndex + 1);

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
  const flags: ParsedFlags = {};
  const parts = flagStr.split(/\s+/).filter(p => p);

  for (const part of parts) {
    if (!part) continue;

    // Check if it's a known flag or hint
    if (part.startsWith('@')) {
      // Hint - always valid
      flags.hint = part.substring(1);
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
    parts.push(`superset=${flags.supersetLabel}`);
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
    parts.push(`@${flags.hint}`);
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
