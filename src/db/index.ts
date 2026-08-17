import { Database } from '@nozbe/watermelondb';
import { createAdapter } from './adapter';
import Routine from './models/Routine';
import Exercise from './models/Exercise';
import RoutineExercise from './models/RoutineExercise';
import RoutineSet from './models/RoutineSet';
import Session from './models/Session';
import SessionSet from './models/SessionSet';

export { Routine, Exercise, RoutineExercise, RoutineSet, Session, SessionSet };

const adapter = createAdapter();

export const database = new Database({
  adapter,
  modelClasses: [Routine, Exercise, RoutineExercise, RoutineSet, Session, SessionSet],
});
