import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';

import { type RoutineExerciseEntry, upsertRoutine } from '@/db/repository';

export class ManualRoutineCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualRoutineCreationError';
  }
}

export interface ManualRoutineCreationInput {
  name: string;
  /** Existing global exercise ids, in the routine order the athlete selected. */
  exerciseIds: readonly string[];
  /** Injected only for deterministic callers and tests. */
  createRoutineId?: () => string;
}

function normalizeRoutineName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Turns an ordered selection into a startable routine plan without mutating the
 * global exercise catalog. Repeating an exercise is intentional: routine entry
 * identity belongs to the `routine_exercises` row, not to `exerciseId`.
 */
export function manualRoutineEntries(exerciseIds: readonly string[]): RoutineExerciseEntry[] {
  return exerciseIds.map((exerciseId, order) => ({
    exerciseId,
    order,
    // A routine with a selected exercise should be startable on creation.
    // The plan remains deliberately minimal; #389 owns later entry editing.
    sets: [{ setType: 'normal' }],
  }));
}

/** Create a local routine from an ordered selection in the existing catalog. */
export async function createManualRoutine(
  database: Database,
  input: ManualRoutineCreationInput
): Promise<string> {
  const name = normalizeRoutineName(input.name);
  if (!name) throw new ManualRoutineCreationError('Enter a routine name.');

  // Validate all ids before the write. A screen can be holding a stale selection
  // while another action removes or replaces a catalog entry; never persist a
  // partial routine in that case.
  for (const exerciseId of new Set(input.exerciseIds)) {
    const count = await database.get('exercises').query(Q.where('id', exerciseId)).fetchCount();
    if (count === 0) {
      throw new ManualRoutineCreationError('That exercise is no longer available.');
    }
  }

  const routineId = input.createRoutineId?.() ?? `routine-${Date.now()}`;
  await upsertRoutine(database, routineId, name, manualRoutineEntries(input.exerciseIds));
  return routineId;
}
