import { Database, appSchema, tableSchema, type AppSchema } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { migrationsForAdapter } from './adapterMigrations';
import { migrations } from './migrations';
import Exercise from './models/Exercise';
import Routine from './models/Routine';
import RoutineExercise from './models/RoutineExercise';
import RoutineSet from './models/RoutineSet';
import Session from './models/Session';
import SessionSet from './models/SessionSet';
import { databaseSchema } from './schema';

const LokiMemoryAdapter = require('lokijs').LokiMemoryAdapter;

function historicalV10Schema(): AppSchema {
  return appSchema({
    version: 10,
    tables: Object.values(databaseSchema.tables).map((table) =>
      tableSchema({
        name: table.name,
        columns:
          table.name === 'exercises'
            ? table.columnArray.filter((column) => column.name !== 'youtube_demo_url')
            : [...table.columnArray],
      })
    ),
  });
}

function open(schema: AppSchema, lokiAdapter: unknown, withMigrations: boolean): Database {
  const adapter = new LokiJSAdapter({
    dbName: 'youtube-demo-migration-probe',
    schema,
    migrations: withMigrations ? migrationsForAdapter(schema.version, migrations) : undefined,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    _testLokiAdapter: lokiAdapter,
    extraLokiOptions: { autosave: false },
  } as never);

  return new Database({
    adapter,
    modelClasses: [Routine, Exercise, RoutineExercise, RoutineSet, Session, SessionSet],
  });
}

async function persistAndClose(database: Database): Promise<void> {
  const loki = (database.adapter as any).underlyingAdapter?._driver?.loki;
  if (!loki) throw new Error('persistAndClose: could not reach the Loki adapter');
  await new Promise<void>((resolve, reject) =>
    loki.saveDatabase((error?: Error) => (error ? reject(error) : resolve()))
  );
  await new Promise<void>((resolve) => loki.close(() => resolve()));
}

async function seedV10Exercise(database: Database): Promise<void> {
  await database.write(async () => {
    await database.get('exercises').create((record: any) => {
      record._raw.id = 'barbell-bench-press';
      record._raw.title = 'Barbell Bench Press';
      record._raw.kind = 'strength';
      record._raw.description = 'Press with control';
      record._raw.image_path = 'exercise-images/bench.jpg';
      record._raw.image_source = 'catalog:Barbell_Bench_Press';
      record._raw.created_at = 1;
    });
  });
}

describe('opening a v10 database under the v11 schema', () => {
  it('preserves populated exercises and reads the new demo URL as null', async () => {
    expect(databaseSchema.version).toBe(11);

    const lokiAdapter = new LokiMemoryAdapter();
    const v10 = open(historicalV10Schema(), lokiAdapter, false);
    await seedV10Exercise(v10);
    await persistAndClose(v10);

    const v11 = open(databaseSchema, lokiAdapter, true);
    const exercise = (await v11.get('exercises').find('barbell-bench-press')) as Exercise;

    expect(exercise.title).toBe('Barbell Bench Press');
    expect(exercise.description).toBe('Press with control');
    expect(exercise.imagePath).toBe('exercise-images/bench.jpg');
    expect(exercise.youtubeDemoUrl).toBeNull();

    await persistAndClose(v11);
  });

  it('resets the v10 database when the migration is withheld', async () => {
    const lokiAdapter = new LokiMemoryAdapter();
    const v10 = open(historicalV10Schema(), lokiAdapter, false);
    await seedV10Exercise(v10);
    await persistAndClose(v10);

    const withheld = open(databaseSchema, lokiAdapter, false);
    await expect(withheld.get('exercises').query().fetch()).resolves.toEqual([]);

    await persistAndClose(withheld);
  });
});
