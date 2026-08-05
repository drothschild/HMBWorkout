import Routine from '@/db/models/Routine';

/**
 * Get a user-friendly filename for exporting a single routine.
 *
 * Format: routine-{routineId}.md
 *
 * @param routine The routine to export
 * @returns Filename for the routine export
 */
export function getRoutineExportName(routine: Routine): string {
  return `routine-${routine.id}.md`;
}

/**
 * Get a user-friendly filename for exporting all exercise history.
 *
 * Format: exercise-history-{YYYY-MM-DD}.md
 * (Date is deterministic per day, so re-exports overwrite previous same-day exports)
 *
 * @returns Filename for exercise history export
 */
export function getSessionHistoryExportName(): string {
  const today = new Date().toISOString().split('T')[0];
  return `exercise-history-${today}.md`;
}
