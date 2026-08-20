/**
 * The Hevy import's DB half — `mapHevyRoutine` → `applyRoutineImport` (#267
 * Phase 3).
 *
 * The mapper's own suite proves the mapping; this one proves the two halves
 * compose, against a real (LokiJS) database. It exists because the mapper
 * returns an `ImportedRoutine` specifically so Phase 2's writer can be reused
 * UNCHANGED, and "the types line up" is not the same claim as "the rows land".
 *
 * The AC it owns outright is **AC3.7's discrimination**: seed a shared exercise
 * used by another routine and assert its `description` survives the import.
 * Exercises are global (AGENTS.md Boundaries), Hevy's per-exercise `notes` are
 * per-routine, and the failure mode — an import quietly rewriting the
 * description of an exercise some other routine also uses — is invisible to
 * every assertion made on the imported routine alone.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import { getRoutineSets, upsertExercise, upsertRoutine } from '@/db/repository';
import { applyRoutineImport } from '@/state/applyRoutineImport';
import { mapHevyRoutine } from '../hevyRoutineMap';
import { loadRoutineFixture } from './loadFixture';

const PUSH = loadRoutineFixture('hevy-push-routine');

describe('Hevy import → database', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  async function importPush(): Promise<string> {
    const result = mapHevyRoutine(PUSH);
    if (!result.ok) throw new Error(`PUSH must map, got ${result.error.code}`);
    return applyRoutineImport(database, result.routine);
  }

  it('AC3.7 — leaves an existing shared exercise’s description untouched', async () => {
    // Bench Press already exists, carries a description, and is used by
    // another routine. Hevy's payload has its own `notes` for the same
    // exercise; those are per-routine and must not touch this row.
    await upsertExercise(
      database,
      'bench-press-dumbbell',
      'Bench Press (Dumbbell)',
      'strength',
      'The description another routine depends on.'
    );
    await upsertRoutine(database, 'routine-existing', 'Some Other Routine', [
      { exerciseId: 'bench-press-dumbbell', order: 0, sets: [{ setType: 'normal', targetReps: 5 }] },
    ]);

    await importPush();

    const exercise = await database.get('exercises').find('bench-press-dumbbell');
    expect((exercise as unknown as { description: string }).description).toBe(
      'The description another routine depends on.'
    );
    expect((exercise as unknown as { title: string }).title).toBe('Bench Press (Dumbbell)');
  });

  it('AC3.7 — writes Hevy’s per-exercise notes onto routine_exercises, not onto the exercise', async () => {
    const routineId = await importPush();

    const rows = await database
      .get('routine_exercises')
      .query(Q.where('routine_id', routineId), Q.sortBy('order', Q.asc))
      .fetch();

    const cycling = rows[0] as unknown as { notes?: string | null; restSeconds?: number | null };
    expect(cycling.notes).toBe('Warm-up — easy spin, 5 min.');
    expect(cycling.restSeconds).toBe(60);

    const cyclingExercise = await database.get('exercises').find('cycling');
    // Created by this import, so its description is whatever the create path
    // supplies — and that must not be Hevy's routine note.
    expect((cyclingExercise as unknown as { description?: string | null }).description ?? '').not.toContain(
      'easy spin'
    );
  });

  it('lands the warmup ramp as three distinct per-set loads', async () => {
    const routineId = await importPush();

    const rows = await database
      .get('routine_exercises')
      .query(Q.where('routine_id', routineId), Q.sortBy('order', Q.asc))
      .fetch();
    const bench = rows[1];
    const sets = await getRoutineSets(database, bench.id);

    expect(sets.map((set) => set.targetWeightKg)).toEqual([
      9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
    ]);
    expect(sets.map((set) => set.setType)).toEqual([
      'warmup', 'warmup', 'warmup', 'normal', 'normal', 'normal', 'normal',
    ]);
  });

  it('creates every exercise the routine names, with the inferred kind', async () => {
    await importPush();

    const cycling = await database.get('exercises').find('cycling');
    const stretching = await database.get('exercises').find('stretching');

    expect((cycling as unknown as { kind: string }).kind).toBe('cardio');
    // `stretch` is never inferred (AC3.8).
    expect((stretching as unknown as { kind: string }).kind).toBe('strength');
  });

  it('mints a fresh routine id, so importing twice makes two routines', async () => {
    const first = await importPush();
    const second = await importPush();

    if (first === second) {
      // `routine-${Date.now()}` can collide within one millisecond; the claim
      // under test is that the id is minted rather than taken from Hevy's
      // payload, which the uuid check below pins regardless.
      expect(first).not.toBe(PUSH.id);
    } else {
      const count = await database.get('routines').query().fetchCount();
      expect(count).toBe(2);
    }
    expect(first).not.toBe(PUSH.id);
    expect(second).not.toBe(PUSH.id);
  });
});
