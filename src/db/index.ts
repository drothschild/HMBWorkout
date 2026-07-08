import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { databaseSchema } from './schema';
import Routine from './models/Routine';
import Exercise from './models/Exercise';
import RoutineExercise from './models/RoutineExercise';
import Session from './models/Session';
import SessionSet from './models/SessionSet';

export { Routine, Exercise, RoutineExercise, Session, SessionSet };

const adapter = new SQLiteAdapter({
  dbName: 'hmbworkout',
  schema: databaseSchema,
  jsi: true,
  onSetUpError: (error) => {
    console.error('Database setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Routine, Exercise, RoutineExercise, Session, SessionSet],
});
