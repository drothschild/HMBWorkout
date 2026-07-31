import { Database } from '@nozbe/watermelondb';
import { routineListPresenter } from './routineListPresenter';

/**
 * A saved routine offered as a starting point on the Today screen.
 * `startable` is false when the routine has no exercises: starting it would
 * produce an empty session, which `startSessionFromRoutine` rejects.
 */
export interface TodayRoutineChoice {
  id: string;
  name: string;
  exerciseCount: number;
  startable: boolean;
}

export type TodayStartOptions =
  | { kind: 'no-routines' }
  | { kind: 'choose-routine'; routines: TodayRoutineChoice[] };

/**
 * Derive what Today can offer the user: a choice among their saved routines,
 * or an empty state when they have none.
 *
 * Today never invents a routine — a session always starts from one the user
 * saved, so an empty database is an empty state, not a blank workout.
 */
export async function todayStartPresenter(db: Database): Promise<TodayStartOptions> {
  const routines = await routineListPresenter(db);

  if (routines.length === 0) {
    return { kind: 'no-routines' };
  }

  return {
    kind: 'choose-routine',
    routines: routines.map((routine) => ({
      ...routine,
      startable: routine.exerciseCount > 0,
    })),
  };
}
