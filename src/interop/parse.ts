/**
 * Parser: markdown → structured (Task 3).
 * AC3.3, AC3.4, AC8.1, AC8.3: strict workout block parsing; malformed blocks throw.
 */

import { parseFlags, ContractError, ParsedDoc, WorkoutLine, SupersetGroup } from './format';
import { SetType } from '@/db/models/SessionSet';
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
 * Format: `- <exercise-id>: [<sets>x<reps>] [flags…]`
 */
function parseWorkoutLine(line: string): WorkoutLine | null {
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

  // Split the rest into parts (sets×reps and flags)
  const parts = rest.split(/\s+/);
  if (parts.length === 0) {
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

  const flagStr = flagParts.join(' ');

  // Parse flags first to get kind
  let parsedFlags: any;
  try {
    parsedFlags = parseFlags(flagStr);
  } catch (e) {
    if (e instanceof ContractError) {
      throw e;
    }
    throw new ContractError(`Invalid flags in line: ${line}`);
  }
  const kind = parsedFlags.kind || 'strength';

  // Parse sets×reps (may be empty for cardio/stretch)
  let targetSets: number | undefined;
  let targetReps: number | undefined;

  if (setRepPart) {
    const match = setRepPart.match(/^(\d+)x(\d+)$/);
    if (!match) {
      throw new ContractError(`Invalid sets×reps format: ${setRepPart}`);
    }
    targetSets = parseInt(match[1], 10);
    targetReps = parseInt(match[2], 10);
  }

  // Validate: cardio/stretch cannot have sets×reps
  if ((kind === 'cardio' || kind === 'stretch') && (targetSets !== undefined || targetReps !== undefined)) {
    throw new ContractError(`${kind} exercise cannot have sets×reps: ${line}`);
  }

  // For cardio/stretch, must have duration
  if ((kind === 'cardio' || kind === 'stretch') && parsedFlags.durationSeconds === undefined) {
    throw new ContractError(`${kind} exercise missing duration: ${line}`);
  }

  // For strength without sets×reps, must either have duration (error) or be malformed
  if (kind === 'strength' && targetSets === undefined && targetReps === undefined && parsedFlags.durationSeconds === undefined) {
    // Check if we have any flags - if not, this is malformed
    if (flagStr.length === 0) {
      throw new ContractError(`Expected sets×reps for strength exercise: ${line}`);
    }
    // If we have flags but no sets×reps and no duration, this is an error for strength
    throw new ContractError(`Strength exercise missing sets×reps: ${line}`);
  }

  // Build workout line
  const workoutLine: WorkoutLine = {
    exerciseId,
    kind,
    targetSets,
    targetReps,
    targetDurationSeconds: parsedFlags.durationSeconds,
    restSeconds: parsedFlags.restSeconds,
    warmupSets: parsedFlags.warmupSets,
    supersetLabel: parsedFlags.supersetLabel,
    hint: parsedFlags.hint,
    rpe: parsedFlags.rpe,
    weight: parsedFlags.weight,
    distance: parsedFlags.distance,
    setType: parsedFlags.setType,
  };

  return workoutLine;
}

/**
 * Group adjacent lines with the same superset label.
 * Non-adjacent lines with the same label are NOT grouped.
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
 * Parse routine markdown.
 */
export function parseRoutine(markdown: string): ParsedDoc {
  try {
    const frontmatter = parseFrontmatter(markdown);
    const blockContent = extractWorkoutBlock(markdown);

    const lines: string[] = blockContent.split('\n').filter(line => line.trim());

    // Parse each line
    const workoutLines: WorkoutLine[] = [];
    for (const line of lines) {
      const parsed = parseWorkoutLine(line);
      if (parsed) {
        workoutLines.push(parsed);
      }
    }

    // Group supersets
    const exercises = groupSupersets(workoutLines);

    return { frontmatter, exercises };
  } catch (error) {
    if (error instanceof ContractError) {
      throw error;
    }
    throw new ContractError(`Failed to parse: ${(error as any).message}`);
  }
}

/**
 * Parse session markdown.
 */
export function parseSession(markdown: string): ParsedDoc {
  // Sessions are parsed the same way as routines
  return parseRoutine(markdown);
}
