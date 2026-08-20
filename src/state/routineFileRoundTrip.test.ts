import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise, upsertRoutine } from '@/db/repository';
import { exportRoutine } from '@/export/exportService';
import { importRoutine } from '@/interop/importRoutine';
import { applyRoutineImport } from './applyRoutineImport';

/**
 * The whole feature in one assertion (#267 Phase 2, the plan's DoD #2):
 * export a routine, import the document back, export the NEW routine, and the
 * two documents must be the same bytes apart from the fields that are supposed
 * to differ — the minted id and the write dates.
 *
 * This is stronger than the field-by-field assertions in
 * `applyRoutineImport.test.ts` and deliberately kept alongside them: those name
 * the fields someone thought to check, while this one fails on any field that
 * survives the export and does NOT survive the import, including one added
 * later. RAMP is the payload for the usual reason — three warmups at three
 * loads is the shape a per-exercise import silently flattens.
 */
it('export → import → export is byte-identical apart from the id and the dates', async () => {
  const db: Database = createTestDatabase();
  try {
    await upsertExercise(db, 'bench-press-dumbbell', 'Bench Press (Dumbbell)', 'strength');
    await upsertExercise(db, 'cable-fly', 'Cable Fly', 'strength');
    await upsertExercise(db, 'lateral-raise', 'Lateral Raise', 'strength');
    await upsertRoutine(db, 'routine-src', 'Push', [
      { exerciseId: 'bench-press-dumbbell', order: 0, restSeconds: 120, notes: 'Up to 50 lb.',
        sets: [
          { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
          { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
          { setType: 'warmup', targetReps: 3, targetWeightKg: 18.14 },
          { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
          { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
          { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
          { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
        ] },
      { exerciseId: 'cable-fly', order: 1, supersetGroup: '5', restSeconds: 60, sets: [{ setType: 'normal', targetReps: 12 }] },
      { exerciseId: 'lateral-raise', order: 2, supersetGroup: '5', restSeconds: 60, sets: [{ setType: 'normal', targetReps: 15 }] },
    ]);

    const first = await exportRoutine(db, 'routine-src');
    const parsed = importRoutine(first);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const newId = await applyRoutineImport(db, parsed.routine);
    const second = await exportRoutine(db, newId);

    const strip = (md: string) => md.replace(/^id: .*$/m, 'id: X').replace(/^(updated|created): .*$/gm, '$1: X');
    expect(strip(second)).toBe(strip(first));
  } finally {
    await closeTestDatabase(db);
  }
});
