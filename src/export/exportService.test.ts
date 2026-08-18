import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import { parseRoutine } from '@/interop/parse';
import {
  upsertExercise,
  upsertRoutine,
  createSession,
  appendSet,
} from '@/db/repository';
import {
  exportRoutine,
  exportSessionHistory,
  getRoutineExportName,
  getSessionHistoryExportName,
} from './exportService';

/**
 * Fixture conversion helper (#276 Phase 6): `RoutineExerciseEntry` no longer
 * carries `warmupSets`/`targetSets`/`targetReps`/`targetDurationSeconds` — only
 * `sets: RoutineSetEntry[]`. Reproduces exactly what the deleted
 * `setsFromCounts` did, so a fixture built from aggregates is behaviourally
 * identical to the pre-Phase-6 one.
 */
function setsFromCounts(
  warmupSets: number,
  targetSets: number,
  targetReps: number,
  targetDurationSeconds = 0
) {
  const reps = targetReps > 0 ? targetReps : undefined;
  const durationSeconds = targetDurationSeconds > 0 ? targetDurationSeconds : undefined;
  return [
    ...Array.from({ length: warmupSets }, () => ({
      setType: 'warmup' as const,
      targetReps: reps,
      targetDurationSeconds: durationSeconds,
    })),
    ...Array.from({ length: targetSets }, () => ({
      setType: 'normal' as const,
      targetReps: reps,
      targetDurationSeconds: durationSeconds,
    })),
  ];
}

describe('exportService', () => {
  let db: Database;

  beforeEach(async () => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  describe('exportRoutine', () => {
    it('exports a routine with exercises to valid markdown', async () => {
      // Create exercise and routine
      await upsertExercise(db, 'ex-1', 'Bench Press', 'strength');
      await upsertRoutine(db, 'routine-1', 'Push Day', [
        { exerciseId: 'ex-1', order: 0, restSeconds: 90, sets: setsFromCounts(1, 4, 6) },
      ]);

      await flush();

      // Export the routine
      const markdown = await exportRoutine(db, 'routine-1');

      // Should be valid markdown
      expect(markdown).toContain('---');
      expect(markdown).toContain('type: workout');
      // Note: routine name lives in the filename, not in the frontmatter content

      // Should parse back correctly
      const parsed = parseRoutine(markdown);
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.exercises).toHaveLength(1);
    });

    it('returns empty string for non-existent routine', async () => {
      const markdown = await exportRoutine(db, 'nonexistent-routine-id');
      expect(markdown).toBe('');
    });

    // #212, the single-item half — narrower than the aggregate one, because of
    // what the serializer can actually do. `serialize.ts` has exactly ONE throw
    // and it is on the SESSION path (`buildSessionSetLine`, unresolvable set
    // identity); `serializeRoutine` has no throw at all. So this catch was never
    // masking a routine contract violation — it was masking `find()`'s rejection
    // on a missing id (now an explicit query, so "not found" keeps its own
    // distinct empty-string answer above) and any DB-layer error underneath.
    //
    // Those are what must stop posing as "here is your routine, it is empty".
    // There is no partial routine to salvage, so swallowing buys nothing.
    it('propagates a database failure instead of returning an empty routine', async () => {
      const failingDb = {
        get: (table: string) => ({
          query: () => ({
            fetch: async () => {
              if (table === 'routines') {
                return [{ id: 'routine-legs2', name: 'Legs' }];
              }
              throw new Error('db unavailable');
            },
          }),
        }),
      } as unknown as Database;

      await expect(exportRoutine(failingDb, 'routine-legs2')).rejects.toThrow('db unavailable');
    });

    it('exports routine with no exercises', async () => {
      await upsertRoutine(db, 'routine-empty', 'Empty Routine', []);

      await flush();

      const markdown = await exportRoutine(db, 'routine-empty');

      // Should still produce valid markdown even with no exercises
      expect(markdown).toContain('type: workout');
      // Note: routine name lives in the filename, not in the frontmatter content
    });

    it('exports routine with multiple exercises preserving order', async () => {
      await upsertExercise(db, 'ex-1', 'Bench Press', 'strength');
      await upsertExercise(db, 'ex-2', 'Incline Press', 'strength');
      await upsertRoutine(db, 'routine-compound', 'Compound Day', [
        { exerciseId: 'ex-1', order: 0, sets: setsFromCounts(1, 4, 6) },
        { exerciseId: 'ex-2', order: 1, sets: setsFromCounts(0, 3, 8) },
      ]);

      await flush();

      const markdown = await exportRoutine(db, 'routine-compound');
      const parsed = parseRoutine(markdown);

      expect(parsed.exercises).toHaveLength(2);
    });

    it('roundtrips: serialize and parse produce equivalent data', async () => {
      await upsertExercise(db, 'ex-squat', 'Squats', 'strength');
      await upsertRoutine(db, 'routine-legs', 'Leg Day', [
        {
          exerciseId: 'ex-squat',
          order: 0,
          restSeconds: 120,
          sets: setsFromCounts(2, 5, 5),
        },
      ]);

      await flush();

      // Export
      const markdown = await exportRoutine(db, 'routine-legs');

      // Parse and verify
      const parsed = parseRoutine(markdown);
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.exercises).toHaveLength(1);
    });

    /**
     * #276 Phase 5: the set list reaches the document.
     *
     * `exportRoutine` is the only production caller of `serializeRoutine`, so
     * this is where the per-set grammar meets real rows rather than fixtures —
     * `routine_sets` read back through `getRoutineSets`, normalized at the
     * boundary the same way every other optional column already is.
     */
    it('exports a routine_sets list one line per set, in order, with per-set weights', async () => {
      await upsertExercise(db, 'ex-bench', 'Bench Press (Dumbbell)', 'strength');
      await upsertRoutine(db, 'routine-ramp', 'Push Day', [
        {
          exerciseId: 'ex-bench',
          order: 0,
          restSeconds: 120,
          sets: [
            { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
            { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
            { setType: 'warmup', targetReps: 3, targetWeightKg: 18.14 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
          ],
        },
      ]);

      await flush();

      const markdown = await exportRoutine(db, 'routine-ramp');

      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(7);

      const parsed = parseRoutine(markdown);
      expect(parsed.exercises).toHaveLength(1);
      const entry = parsed.exercises[0] as any;
      expect(entry.restSeconds).toBe(120);
      expect(entry.sets.map((s: any) => s.targetWeightKg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(entry.sets.map((s: any) => s.setType)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      expect(entry.sets[3]).toEqual({
        setType: 'normal',
        targetReps: 8,
        targetRepsMax: 10,
        targetWeightKg: 22.68,
      });
    });

    it('a prescribed 0 kg survives the export boundary, rather than reading as absent', async () => {
      // The `?? undefined` normalization must stay `??`, not `||`: a bodyweight
      // exercise is prescribed at 0 kg, and `|| undefined` erases it. Nothing
      // else in this suite passes a zero through this mapping, so without this
      // the two operators are indistinguishable here.
      await upsertExercise(db, 'ex-pushup', 'Push-Up', 'strength');
      await upsertRoutine(db, 'routine-bw', 'Bodyweight', [
        {
          exerciseId: 'ex-pushup',
          order: 0,
          sets: [{ setType: 'normal', targetReps: 20, targetWeightKg: 0 }],
        },
      ]);

      await flush();

      const markdown = await exportRoutine(db, 'routine-bw');
      expect(markdown).toContain('target_weight=0');

      const entry = parseRoutine(markdown).exercises[0] as any;
      expect(entry.sets).toEqual([{ setType: 'normal', targetReps: 20, targetWeightKg: 0 }]);
    });

    /**
     * One discriminating fixture per `?? undefined` at the export boundary
     * (I1, #293 review).
     *
     * `?? undefined` and `|| undefined` differ on exactly one input — 0 — so a
     * suite with no zero in it cannot tell them apart, and five of the six
     * guards here survived mutation for that reason. The blast radius is real:
     * under `||` a prescribed 0 reads as absent, the flag is never emitted, and
     * the value is gone from the document. `target_weight`'s own fixture is
     * above; these are its five siblings, one test each so a regression names
     * the guard that broke.
     */
    describe('a prescribed 0 survives the export boundary on every field', () => {
      it.each([
        ['targetReps', 'strength', '1x0'],
        ['targetRepsMax', 'strength', 'reps_max=0'],
        ['targetDurationSeconds', 'cardio', 'duration=0:00'],
        ['targetDistanceM', 'cardio', 'target_distance=0'],
      ] as const)('%s', async (field, kind, onTheWire) => {
        await upsertExercise(db, `ex-zero-${field}`, 'Zero', kind);
        await upsertRoutine(db, `routine-zero-${field}`, 'Zeroes', [
          {
            exerciseId: `ex-zero-${field}`,
            order: 0,
            sets: [{ setType: 'normal', [field]: 0 }],
          },
        ]);

        await flush();

        const markdown = await exportRoutine(db, `routine-zero-${field}`);
        expect(markdown).toContain(onTheWire);

        const entry = parseRoutine(markdown).exercises[0] as any;
        expect(entry.sets).toEqual([{ setType: 'normal', [field]: 0 }]);
      });

      it('restSeconds', async () => {
        // The entry-level one. A rest of 0 is "straight into the next set".
        await upsertExercise(db, 'ex-zero-rest', 'Zero Rest', 'strength');
        await upsertRoutine(db, 'routine-zero-rest', 'Zeroes', [
          {
            exerciseId: 'ex-zero-rest',
            order: 0,
            restSeconds: 0,
            sets: [{ setType: 'normal', targetReps: 5 }],
          },
        ]);

        await flush();

        const markdown = await exportRoutine(db, 'routine-zero-rest');
        expect(markdown).toContain('rest=0');

        expect((parseRoutine(markdown).exercises[0] as any).restSeconds).toBe(0);
      });
    });

    it('each entry gets its OWN set list, not the first entry\'s', async () => {
      // I2 (#293 review). `setsByEntry[index]` is the join between the
      // `Promise.all(routineExercises.map(…))` above and the
      // `routineExercises.map((re, index) => …)` below, and it is the
      // load-bearing part of the new export code. Every prior fixture with two
      // entries gave them identical set lists, so `setsByEntry[0]` — every
      // entry wearing the first one's prescription — was indistinguishable.
      await upsertExercise(db, 'ex-a', 'Squat', 'strength');
      await upsertExercise(db, 'ex-b', 'Curl', 'strength');
      await upsertRoutine(db, 'routine-distinct', 'Distinct', [
        {
          exerciseId: 'ex-a',
          order: 0,
          sets: [
            { setType: 'warmup', targetReps: 5, targetWeightKg: 20 },
            { setType: 'normal', targetReps: 3, targetWeightKg: 100 },
          ],
        },
        {
          exerciseId: 'ex-b',
          order: 1,
          sets: [{ setType: 'normal', targetReps: 12, targetWeightKg: 10 }],
        },
      ]);

      await flush();

      const parsed = parseRoutine(await exportRoutine(db, 'routine-distinct'));
      expect(parsed.exercises).toHaveLength(2);
      expect((parsed.exercises[0] as any).sets).toEqual([
        { setType: 'warmup', targetReps: 5, targetWeightKg: 20 },
        { setType: 'normal', targetReps: 3, targetWeightKg: 100 },
      ]);
      expect((parsed.exercises[1] as any).sets).toEqual([
        { setType: 'normal', targetReps: 12, targetWeightKg: 10 },
      ]);
    });

    it('an entry with no routine_sets rows exports as a bare exercise line', async () => {
      // The aggregate-only shape every routine written before Phase 1 has —
      // reproduced here with an explicit empty `sets` list, since #276 Phase 6
      // removed the aggregate fields from `RoutineExerciseEntry` entirely and
      // an empty list is now the only way to leave an entry with no rows.
      // It exports as an exercise the routine names with nothing prescribed —
      // NOT as a dropped exercise (which is what makes this worth pinning) and
      // NOT with any aggregate re-derived, since none exists in the model any more.
      await upsertExercise(db, 'ex-row', 'Barbell Row', 'strength');
      await upsertRoutine(db, 'routine-legacy', 'Pull Day', [
        { exerciseId: 'ex-row', order: 0, sets: [] },
      ]);

      await flush();

      const parsed = parseRoutine(await exportRoutine(db, 'routine-legacy'));
      expect(parsed.exercises).toHaveLength(1);
      expect((parsed.exercises[0] as any).exerciseId).toBe('ex-row');
      expect((parsed.exercises[0] as any).sets).toEqual([]);
    });

    it('an entry with no routine_sets rows exports and parses back whatever its kind', async () => {
      // C1 (#293 review). The zero-set entry is not a strength-only shape:
      // `acceptDraft` does not write `routine_sets` yet, so EVERY routine in
      // the app has zero rows for every entry, cardio and stretch included.
      // The exercise line has to say "this entry prescribes nothing" in a way
      // the parser can read without also demanding a duration it does not have.
      await upsertExercise(db, 'ex-erg', 'Rowing Erg', 'cardio');
      await upsertExercise(db, 'ex-pigeon', 'Pigeon Pose', 'stretch');
      await upsertExercise(db, 'ex-bench2', 'Bench Press', 'strength');
      await upsertRoutine(db, 'routine-mixed', 'Conditioning', [
        { exerciseId: 'ex-erg', order: 0, restSeconds: 60, sets: [] },
        { exerciseId: 'ex-pigeon', order: 1, sets: [] },
        { exerciseId: 'ex-bench2', order: 2, sets: [] },
      ]);

      await flush();

      const markdown = await exportRoutine(db, 'routine-mixed');
      const parsed = parseRoutine(markdown);

      expect(parsed.exercises).toHaveLength(3);
      expect(parsed.exercises.map((e: any) => e.exerciseId)).toEqual([
        'ex-erg',
        'ex-pigeon',
        'ex-bench2',
      ]);
      expect(parsed.exercises.map((e: any) => e.sets)).toEqual([[], [], []]);
      expect((parsed.exercises[0] as any).kind).toBe('cardio');
      expect((parsed.exercises[0] as any).restSeconds).toBe(60);
      expect((parsed.exercises[1] as any).kind).toBe('stretch');
    });

    it('a set prescribing only a load, a rep-range top or a distance is not dropped', async () => {
      // C2 (#293 review). All five `routine_sets` columns are independently
      // optional, so a set may carry a load and no reps. Such a set serialized
      // to a line the parser read as "an exercise prescribing nothing" and the
      // set VANISHED — two sets in, one set out. Silent loss is the failure
      // this contract exists to prevent; every set that goes in comes back.
      await upsertExercise(db, 'ex-press', 'Overhead Press', 'strength');
      await upsertExercise(db, 'ex-run', 'Treadmill', 'cardio');
      await upsertRoutine(db, 'routine-partial', 'Partial Prescriptions', [
        {
          exerciseId: 'ex-press',
          order: 0,
          sets: [
            { setType: 'normal', targetReps: 5, targetWeightKg: 40 },
            { setType: 'normal', targetWeightKg: 50 },
            { setType: 'normal', targetRepsMax: 12 },
            { setType: 'warmup' },
          ],
        },
        {
          exerciseId: 'ex-run',
          order: 1,
          sets: [{ setType: 'normal', targetDistanceM: 5000 }],
        },
      ]);

      await flush();

      const parsed = parseRoutine(await exportRoutine(db, 'routine-partial'));
      expect(parsed.exercises).toHaveLength(2);

      expect((parsed.exercises[0] as any).sets).toEqual([
        { setType: 'normal', targetReps: 5, targetWeightKg: 40 },
        { setType: 'normal', targetWeightKg: 50 },
        { setType: 'normal', targetRepsMax: 12 },
        { setType: 'warmup' },
      ]);
      expect((parsed.exercises[1] as any).sets).toEqual([
        { setType: 'normal', targetDistanceM: 5000 },
      ]);
    });

    it('a cardio or stretch set prescribed in reps round-trips instead of throwing', async () => {
      // C3 (#293 review round 2). Round 1 moved the cardio/stretch DURATION
      // requirement into the session-only tail and left its sibling — the
      // sets-slot PROHIBITION — unconditional above the split, so every cardio
      // or stretch set carrying `target_reps` exported to a document
      // `parseRoutine` threw on: 64 of the 192 exhaustively enumerated storable
      // `routine_sets` shapes, 32 per kind.
      //
      // Nothing validates a set's fields against its parent exercise's kind, so
      // the shape is ordinary rather than exotic: `replaceRoutineSets` writes
      // it, `updateRoutineExerciseExerciseId` deliberately KEEPS reps across a
      // substitution (so re-pointing a rep-prescribed entry at an existing
      // cardio exercise produces exactly this), and "5 × cat-cow" is how a
      // stretch is actually prescribed.
      await upsertExercise(db, 'ex-erg2', 'Rowing Erg', 'cardio');
      await upsertExercise(db, 'ex-catcow', 'Cat-Cow', 'stretch');
      await upsertRoutine(db, 'routine-reps-cardio', 'Reps On Cardio', [
        {
          exerciseId: 'ex-erg2',
          order: 0,
          sets: [
            { setType: 'normal', targetReps: 5 },
            { setType: 'normal', targetReps: 8, targetDurationSeconds: 300 },
          ],
        },
        {
          exerciseId: 'ex-catcow',
          order: 1,
          sets: [{ setType: 'warmup', targetReps: 5, targetRepsMax: 10 }],
        },
      ]);

      await flush();

      const parsed = parseRoutine(await exportRoutine(db, 'routine-reps-cardio'));
      expect(parsed.exercises).toHaveLength(2);
      expect((parsed.exercises[0] as any).kind).toBe('cardio');
      expect((parsed.exercises[0] as any).sets).toEqual([
        { setType: 'normal', targetReps: 5 },
        { setType: 'normal', targetReps: 8, targetDurationSeconds: 300 },
      ]);
      expect((parsed.exercises[1] as any).kind).toBe('stretch');
      expect((parsed.exercises[1] as any).sets).toEqual([
        { setType: 'warmup', targetReps: 5, targetRepsMax: 10 },
      ]);
    });
  });

  describe('exportSessionHistory', () => {
    it('exports all completed sessions with their sets', async () => {
      // Create exercise, routine, and session with a set
      await upsertExercise(db, 'ex-deadlift', 'Deadlift', 'strength');
      await upsertRoutine(db, 'routine-strength', 'Strength', [
        { exerciseId: 'ex-deadlift', order: 0, sets: setsFromCounts(1, 3, 5) },
      ]);

      const reIds = await db.get('routine_exercises').query().fetch() as any[];
      const reId = reIds[0].id;

      await createSession(db, { sessionId: 'session-1', routineId: 'routine-strength', startedAtMs: 1000 });
      await appendSet(db, 'session-1', reId, { setType: 'warmup', reps: 5, weightKg: 135 });

      // Complete the session
      await db.write(async () => {
        const session = await db.get('sessions').find('session-1');
        if (session) {
          await session.update((s: any) => {
            s._raw.ended_at = Date.now();
          });
        }
      });

      await flush();

      // Export history
      const { markdown } = await exportSessionHistory(db);

      // Should contain the session
      expect(markdown).toContain('type: workout-session');
      // Sessions export with exercise IDs, not titles
      expect(markdown).toContain('ex-deadlift');
    });

    it('handles empty history gracefully', async () => {
      const { markdown, failures } = await exportSessionHistory(db);

      // Empty history should return empty string
      expect(typeof markdown).toBe('string');
      expect(markdown).toBe('');
      expect(failures).toStrictEqual([]);
    });

    // #212. `serializeSession` guarantees it never emits a PARTIAL session —
    // every logged set produces a line or the call throws. That guarantee used
    // to stop dead at this caller, which caught per session and continued, so
    // the aggregate was silently short at session granularity: exactly the
    // data-loss shape the set-level rule exists to prevent, one level up.
    //
    // The fix is not to drop the resilience — for a backup, 47 of 48 sessions
    // beats 0 of 48 — it is to remove the SILENCE, so a caller can say
    // "47 of 48" instead of handing the user a short file that looks whole.
    it('reports a session it could not serialize instead of silently dropping it', async () => {
      await upsertExercise(db, 'ex-row', 'Row', 'strength');
      await upsertRoutine(db, 'routine-pull', 'Pull', [
        { exerciseId: 'ex-row', order: 0, sets: setsFromCounts(0, 3, 8) },
      ]);
      const reId = ((await db.get('routine_exercises').query().fetch()) as any[])[0].id;

      // A good session, and a doomed one. Both must be accounted for.
      await createSession(db, {
        sessionId: 'session-good',
        routineId: 'routine-pull',
        startedAtMs: 1000,
      });
      await appendSet(db, 'session-good', reId, {
        setType: 'working',
        reps: 8,
        exerciseId: 'ex-row',
      });

      await createSession(db, {
        sessionId: 'session-doomed',
        routineId: 'routine-pull',
        startedAtMs: 2000,
      });
      // No stamp: the pre-v3 shape.
      await appendSet(db, 'session-doomed', reId, { setType: 'working', reps: 8 });

      for (const id of ['session-good', 'session-doomed']) {
        await db.write(async () => {
          const session = await db.get('sessions').find(id);
          await session.update((s: any) => {
            s._raw.ended_at = Date.now();
          });
        });
      }
      await flush();

      // Destroy the row WITHOUT stamping first. `upsertRoutine`'s drop branch
      // would have stamped these sets; going around it is what leaves a set
      // with neither a stamp nor a surviving row — genuinely unidentifiable,
      // and the documented case where `serializeSession` throws.
      await db.write(async () => {
        const row = await db.get('routine_exercises').find(reId);
        await row.destroyPermanently();
      });
      await flush();

      const { markdown, failures } = await exportSessionHistory(db);

      // The failure is named, not swallowed...
      expect(failures.map((f) => f.sessionId)).toStrictEqual(['session-doomed']);
      expect(failures[0].reason).toBeTruthy();
      // ...and the export is not abandoned over one bad session.
      expect(markdown).toContain('type: workout-session');
      expect(markdown).not.toContain('session-doomed');
    });

    it('exports multiple sessions separately', async () => {
      await upsertExercise(db, 'ex-bench', 'Bench', 'strength');
      await upsertRoutine(db, 'routine-push', 'Push', [
        { exerciseId: 'ex-bench', order: 0, sets: setsFromCounts(1, 3, 8) },
      ]);

      const reIds = await db.get('routine_exercises').query().fetch() as any[];
      const reId = reIds[0].id;

      // Create first session
      await createSession(db, { sessionId: 'session-1', routineId: 'routine-push', startedAtMs: 1000 });
      await appendSet(db, 'session-1', reId, { setType: 'working', reps: 8, weightKg: 185 });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-1');
        if (s) await s.update((x: any) => { x._raw.ended_at = Date.now(); });
      });

      // Create second session
      await createSession(db, { sessionId: 'session-2', routineId: 'routine-push', startedAtMs: 2000 });
      await appendSet(db, 'session-2', reId, { setType: 'working', reps: 8, weightKg: 190 });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-2');
        if (s) await s.update((x: any) => { x._raw.ended_at = Date.now(); });
      });

      await flush();

      const { markdown } = await exportSessionHistory(db);

      // Should contain sessions
      expect(markdown).toContain('type: workout-session');
    });

    it('handles orphaned sets where routine_exercise row is deleted but exercise_id stamp survives', async () => {
      await upsertExercise(db, 'ex-squat', 'Squat', 'strength');
      await upsertRoutine(db, 'routine-legs', 'Legs', [
        { exerciseId: 'ex-squat', order: 0, sets: setsFromCounts(1, 4, 8) },
      ]);

      const reIds = await db.get('routine_exercises').query().fetch() as any[];
      const reId = reIds[0].id;

      await createSession(db, { sessionId: 'session-orphan', routineId: 'routine-legs', startedAtMs: 1000 });
      await appendSet(db, 'session-orphan', reId, { setType: 'working', reps: 8, weightKg: 225, exerciseId: 'ex-squat' });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-orphan');
        if (s) await s.update((x: any) => { x._raw.ended_at = Date.now(); });
      });

      await flush();

      // Now delete the routine_exercise row (simulating what upsertRoutine does)
      await db.write(async () => {
        const re = await db.get('routine_exercises').find(reId);
        if (re) {
          await re.destroyPermanently();
        }
      });

      await flush();

      // Export should still work because sets have exercise_id stamp
      const { markdown } = await exportSessionHistory(db);

      // Should still contain the set data via the stamp (exercise ID and weight)
      expect(markdown).toContain('ex-squat');
      expect(markdown).toContain('225');
    });
  });

  describe('getRoutineExportName', () => {
    it('generates sensible filename for routine', async () => {
      await upsertRoutine(db, 'routine-named', 'Push Day', []);
      await flush();

      const routine = await db.get('routines').find('routine-named');
      const name = getRoutineExportName(routine as any);

      expect(name).toMatch(/^routine-.*\.md$/);
      expect(name).toContain('routine-named');
    });

    it('filename is unique across multiple routines', async () => {
      await upsertRoutine(db, 'routine-push', 'Push', []);
      await upsertRoutine(db, 'routine-pull', 'Pull', []);
      await flush();

      const routine1 = await db.get('routines').find('routine-push');
      const routine2 = await db.get('routines').find('routine-pull');

      const name1 = getRoutineExportName(routine1 as any);
      const name2 = getRoutineExportName(routine2 as any);

      expect(name1).not.toBe(name2);
    });
  });

  describe('getSessionHistoryExportName', () => {
    it('generates sensible filename for session history', () => {
      const name = getSessionHistoryExportName();

      expect(name).toMatch(/^exercise-history-.*\.md$/);
    });

    it('includes date in filename', () => {
      const name = getSessionHistoryExportName();

      // Should contain a date pattern YYYY-MM-DD
      expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('is deterministic within same day', () => {
      const name1 = getSessionHistoryExportName();
      const name2 = getSessionHistoryExportName();

      // Same day should produce same filename
      expect(name1).toBe(name2);
    });
  });
});
