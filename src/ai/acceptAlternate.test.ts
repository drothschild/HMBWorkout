/**
 * The accept path for a chosen alternate. Same two invariants as `acceptDraft`:
 * exercise identity is `slugifyTitle(title)`, and creating is allowed while
 * mutating an existing exercise is not — exercises are global and shared by
 * every routine, so a swap in one workout must not rename or re-kind a movement
 * out from under another.
 */

import { Database } from '@nozbe/watermelondb';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import { applyAlternateToRoutine, ensureAlternateExercise } from './acceptAlternate';
import { DraftValidationError } from './draftSchema';

const ROUTINE_ID = 'routine-accept-alternate';

const ALTERNATE = {
  title: 'Dumbbell Floor Press',
  description: 'Press from the floor with elbows tucked, pausing when the triceps touch.',
};

describe('ensureAlternateExercise', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('creates the exercise, keyed by slugifyTitle(title), carrying the description', async () => {
    const exerciseId = await ensureAlternateExercise(database, ALTERNATE, 'strength');

    expect(exerciseId).toBe('dumbbell-floor-press');

    const created = (await database.get('exercises').find('dumbbell-floor-press')) as any;
    expect(created.title).toBe('Dumbbell Floor Press');
    expect(created.kind).toBe('strength');
    expect(created.description).toBe(ALTERNATE.description);
  });

  it('takes the kind from the entry being replaced, not from the model', async () => {
    await ensureAlternateExercise(database, ALTERNATE, 'stretch');

    const created = (await database.get('exercises').find('dumbbell-floor-press')) as any;
    expect(created.kind).toBe('stretch');
  });

  it('reuses an existing exercise without mutating it', async () => {
    await database.write(async () => {
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'dumbbell-floor-press';
        e.title = 'DB Floor Press (mine)';
        e.kind = 'cardio';
        e.description = 'my own notes';
      });
    });

    const exerciseId = await ensureAlternateExercise(database, ALTERNATE, 'strength');

    expect(exerciseId).toBe('dumbbell-floor-press');
    const existing = (await database.get('exercises').find('dumbbell-floor-press')) as any;
    expect(existing.title).toBe('DB Floor Press (mine)');
    expect(existing.kind).toBe('cardio');
    expect(existing.description).toBe('my own notes');
    expect(await database.get('exercises').query().fetchCount()).toBe(1);
  });

  it('normalizes whitespace in the title, like acceptDraft', async () => {
    await ensureAlternateExercise(
      database,
      { ...ALTERNATE, title: '  Dumbbell   Floor  Press  ' },
      'strength'
    );

    const created = (await database.get('exercises').find('dumbbell-floor-press')) as any;
    expect(created.title).toBe('Dumbbell Floor Press');
  });

  it('validates the alternate a second time before writing anything', async () => {
    await expect(
      ensureAlternateExercise(database, { title: '???', description: 'x' } as any, 'strength')
    ).rejects.toThrow(DraftValidationError);

    expect(await database.get('exercises').query().fetchCount()).toBe(0);
  });
});

describe('applyAlternateToRoutine', () => {
  let database: Database;
  let rowId: string;

  beforeEach(async () => {
    database = createTestDatabase();

    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = ROUTINE_ID;
        r.name = 'Push Day';
      });
      const row = await database.get('routine_exercises').create((re: any) => {
        re.routineId = ROUTINE_ID;
        re.exerciseId = 'barbell-bench-press';
        re.order = 1;
        re.warmupSets = 2;
        re.targetSets = 4;
      });
      rowId = (row as any).id;
    });
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('swaps the exercise on the entry at that order, keeping the row id', async () => {
    await applyAlternateToRoutine(database, ROUTINE_ID, 1, 'dumbbell-floor-press');

    const row = (await database.get('routine_exercises').find(rowId)) as any;
    expect(row._raw.exercise_id).toBe('dumbbell-floor-press');
    expect(row.warmupSets).toBe(2);
    expect(row.targetSets).toBe(4);
    expect(await database.get('routine_exercises').query().fetchCount()).toBe(1);
  });

  it('throws when no entry sits at that order, rather than writing somewhere else', async () => {
    await expect(
      applyAlternateToRoutine(database, ROUTINE_ID, 5, 'dumbbell-floor-press')
    ).rejects.toThrow(/order 5/);

    const row = (await database.get('routine_exercises').find(rowId)) as any;
    expect(row._raw.exercise_id).toBe('barbell-bench-press');
  });
});
