/**
 * `applyRoutineImport` — the DB half of the markdown import path (#267 Phase 2).
 *
 * Covers AC2.2 (the RAMP round trip lands in `routine_sets`, under a fresh
 * `routine-<epoch>` id), AC2.3 (exercises are created but never mutated), AC2.4
 * (a name collision produces a SECOND routine and leaves the first's
 * `routine_exercises` row ids untouched) and the write half of AC2.5 (a
 * malformed document writes nothing at all).
 *
 * The round trips here go through the real serializer — `exportRoutine` on a
 * routine this suite wrote — rather than a literal, because AC2.2's subject is
 * the DB → export → import → DB loop rather than the bytes. The bytes are
 * pinned in `src/interop/__tests__/importRoutine.test.ts`.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import {
  RoutineExerciseEntry,
  getRoutineSets,
  upsertExercise,
  upsertRoutine,
} from '@/db/repository';
import { exportRoutine } from '@/export/exportService';
import { importRoutine } from '@/interop/importRoutine';
import { slugifyTitle } from '@/ai/draftSchema';
import { applyRoutineImport } from './applyRoutineImport';

/** RAMP: three warmups at three DIFFERENT loads, then four working sets. */
const RAMP_SETS = [
  { setType: 'warmup' as const, targetReps: 5, targetWeightKg: 9.07 },
  { setType: 'warmup' as const, targetReps: 5, targetWeightKg: 11.34 },
  { setType: 'warmup' as const, targetReps: 3, targetWeightKg: 18.14 },
  { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
];

describe('applyRoutineImport', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  /** Seed a routine to export, so the import path reads a genuine document. */
  async function seedRampRoutine(routineId: string, name: string): Promise<void> {
    await upsertExercise(
      database,
      'bench-press-dumbbell',
      'Bench Press (Dumbbell)',
      'strength',
      'The original description.'
    );
    const entries: RoutineExerciseEntry[] = [
      {
        exerciseId: 'bench-press-dumbbell',
        order: 0,
        restSeconds: 120,
        notes: 'Up to 50 lb.',
        sets: RAMP_SETS,
      },
    ];
    await upsertRoutine(database, routineId, name, entries);
  }

  async function importedRoutineFrom(markdown: string): Promise<string> {
    const parsed = importRoutine(markdown);
    if (!parsed.ok) {
      throw new Error(`import refused: ${parsed.error.code} — ${parsed.error.message}`);
    }
    return applyRoutineImport(database, parsed.routine);
  }

  async function entryRowsOf(routineId: string): Promise<any[]> {
    const rows = await database
      .get('routine_exercises')
      .query(Q.where('routine_id', routineId))
      .fetch();
    return rows.map((row) => row).sort((a, b) => (a as any)._raw.order - (b as any)._raw.order);
  }

  describe('AC2.2: the ramp survives export → import → DB', () => {
    it('writes all seven sets in order under a fresh routine-<epoch> id', async () => {
      await seedRampRoutine('routine-original', 'Push');
      const markdown = await exportRoutine(database, 'routine-original');

      const newId = await importedRoutineFrom(markdown);

      expect(newId).not.toBe('routine-original');
      expect(newId).toMatch(/^routine-\d+$/);

      const rows = await entryRowsOf(newId);
      expect(rows).toHaveLength(1);

      const sets = await getRoutineSets(database, (rows[0] as any).id);
      expect(sets.map((s) => s.setType)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      // The headline: three distinct ascending warmup loads reach the column.
      expect(sets.map((s) => s.targetWeightKg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(sets.map((s) => s.targetReps)).toEqual([5, 5, 3, 8, 8, 8, 8]);
    });

    it('carries the routine name and the entry-level plan across', async () => {
      await seedRampRoutine('routine-original', 'Push');
      const markdown = await exportRoutine(database, 'routine-original');

      const newId = await importedRoutineFrom(markdown);

      const routine = await database.get('routines').find(newId);
      expect((routine as any).name).toBe('Push');

      const rows = await entryRowsOf(newId);
      expect((rows[0] as any)._raw.rest_seconds).toBe(120);
      expect((rows[0] as any)._raw.notes).toBe('Up to 50 lb.');
    });
  });

  describe('AC2.3: exercises are created, never mutated', () => {
    it('creates a missing exercise with id === slugifyTitle(title)', async () => {
      await seedRampRoutine('routine-original', 'Push');
      const markdown = await exportRoutine(database, 'routine-original');

      // Wipe the exercise so the import has to create it.
      const existing = await database.get('exercises').find('bench-press-dumbbell');
      await database.write(async () => {
        await (existing as any).destroyPermanently();
      });
      expect(await database.get('exercises').query().fetchCount()).toBe(0);

      await importedRoutineFrom(markdown);

      const created = await database.get('exercises').find('bench-press-dumbbell');
      expect((created as any).id).toBe('bench-press-dumbbell');
      expect(slugifyTitle((created as any).title)).toBe('bench-press-dumbbell');
    });

    it('leaves an existing exercise’s kind, title and description alone', async () => {
      // Seeded with a DIFFERENT kind from what the document says, and with a
      // description the document cannot carry at all. A matching-kind seed
      // could not fail a mutant that dropped the create-only guard, because the
      // write would be a no-op.
      await seedRampRoutine('routine-original', 'Push');
      const markdown = await exportRoutine(database, 'routine-original');
      await upsertExercise(
        database,
        'bench-press-dumbbell',
        'Bench Press (Dumbbell)',
        'cardio',
        'Shared across every routine.'
      );

      await importedRoutineFrom(markdown);

      const row = await database.get('exercises').find('bench-press-dumbbell');
      expect((row as any)._raw.kind).toBe('cardio');
      expect((row as any).title).toBe('Bench Press (Dumbbell)');
      expect((row as any).description).toBe('Shared across every routine.');
    });

    it('imports a document whose exported kind differs, without re-kinding', async () => {
      // Discriminates the assertion above from a fixture that never had a kind
      // disagreement in the document: the exported markdown here says
      // `strength` (no `kind=` flag) while the stored row says `cardio`.
      await seedRampRoutine('routine-original', 'Push');
      const markdown = await exportRoutine(database, 'routine-original');
      expect(markdown).not.toContain('kind=');
      const parsed = importRoutine(markdown);
      if (!parsed.ok) throw new Error('fixture should parse');
      expect(parsed.routine.exercises[0].kind).toBe('strength');
    });
  });

  describe('AC2.4: a name collision makes a second routine, not an overwrite', () => {
    it('creates a second routine and leaves the first’s row ids untouched', async () => {
      await seedRampRoutine('routine-original', 'Push');
      const markdown = await exportRoutine(database, 'routine-original');

      const beforeRowIds = (await entryRowsOf('routine-original')).map((r) => (r as any).id);
      expect(beforeRowIds).toHaveLength(1);

      const newId = await importedRoutineFrom(markdown);

      expect(await database.get('routines').query().fetchCount()).toBe(2);
      expect(newId).not.toBe('routine-original');

      // Row-id stability is what `session_sets.routine_exercise_id` depends on.
      // "Two routines exist" alone passes a delete-and-recreate mutant; this
      // asserts the original's row is the SAME row.
      const afterRowIds = (await entryRowsOf('routine-original')).map((r) => (r as any).id);
      expect(afterRowIds).toEqual(beforeRowIds);

      // ...and the new routine owns its own, distinct rows.
      const newRowIds = (await entryRowsOf(newId)).map((r) => (r as any).id);
      expect(newRowIds).toHaveLength(1);
      expect(newRowIds[0]).not.toBe(beforeRowIds[0]);

      const both = await database.get('routines').query().fetch();
      expect(both.map((r) => (r as any).name).sort()).toEqual(['Push', 'Push']);
    });
  });

  describe('AC2.5: a malformed document writes nothing', () => {
    const MALFORMED = [
      ['an unknown flag key', '- back-squat: 1x5 bogus=3'],
      ['an unparseable sets slot', '- back-squat: 3x5'],
    ] as const;

    it.each(MALFORMED)('refuses %s before any write', async (_label, line) => {
      const markdown = `---\ntype: workout-routine\nid: routine-1\nname: Bad\nupdated: 2026-08-16\ntags: []\ncreated: 2026-08-16\n---\n\n\`\`\`workout\n${line}\n\`\`\`\n`;

      const before = {
        routines: await database.get('routines').query().fetchCount(),
        entries: await database.get('routine_exercises').query().fetchCount(),
        sets: await database.get('routine_sets').query().fetchCount(),
        exercises: await database.get('exercises').query().fetchCount(),
      };

      const parsed = importRoutine(markdown);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error.code).toBe('unparseable');

      expect({
        routines: await database.get('routines').query().fetchCount(),
        entries: await database.get('routine_exercises').query().fetchCount(),
        sets: await database.get('routine_sets').query().fetchCount(),
        exercises: await database.get('exercises').query().fetchCount(),
      }).toEqual(before);
    });

    it('proves those zero counts were a real observation', async () => {
      // A "nothing was written" assertion is worthless if the fixture could
      // never write. The same document, made well-formed, writes.
      const markdown = `---\ntype: workout-routine\nid: routine-1\nname: Good\nupdated: 2026-08-16\ntags: []\ncreated: 2026-08-16\n---\n\n\`\`\`workout\n- back-squat: 1x5\n\`\`\`\n`;
      await importedRoutineFrom(markdown);
      expect(await database.get('routines').query().fetchCount()).toBe(1);
      expect(await database.get('routine_exercises').query().fetchCount()).toBe(1);
      expect(await database.get('routine_sets').query().fetchCount()).toBe(1);
      expect(await database.get('exercises').query().fetchCount()).toBe(1);
    });
  });
});
