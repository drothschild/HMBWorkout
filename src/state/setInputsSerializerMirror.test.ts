/**
 * The executable pin on a claim #304 made three times in prose and nowhere in
 * code: that `buildLogSetValues`'s guard "mirrors `buildSessionSetLine`
 * exactly".
 *
 * The #288 suite in `setInputs.test.ts` restates the predicate against itself
 * (`values.reps !== undefined || values.durationSeconds !== undefined`), which
 * cannot fail for any reason worth knowing about. Nothing imported both
 * modules, so if the serializer's branch gained or lost a measurement — or
 * `SetInputValues` gained `distanceM`, which the grammar already accepts —
 * the two would drift with the whole suite green. This file imports both and
 * drives the real serializer and the real parser, on the same reasoning that
 * keeps `parse.ts` alive with no production caller.
 *
 * It also carries the failing pin for #305 at the bottom.
 */

import { buildLogSetValues, type SetInputTexts } from './setInputs';
import type { SetInputValues } from './sessionPresenter';
import { lbsToKg } from './weightUnits';
import { serializeSession } from '@/interop/serialize';
import { parseSession } from '@/interop/parse';
import { createEngine } from '@/engine';
import type { SessionState } from '@/engine/types';
import type { SetType } from '@/db/models/SessionSet';
import type { ExerciseKind } from '@/db/models/Exercise';

const EXERCISE_ID = 'bench-press';
const ROW_ID = 'routine-exercise-0';

/**
 * Serialize one logged set and parse it back. Returns the emitted line plus
 * whichever of the two outcomes happened, so a test can assert on the real
 * grammar rather than on a restatement of the predicate.
 *
 * Note the asymmetry this exists to expose: `serializeSession` does not throw
 * on a measurement-less set, so `emitted` is always a string. Only
 * `parseSession` objects, which is exactly why the corruption is silent.
 */
function serializeThenParse(
  set: { reps?: number; weightKg?: number; durationSeconds?: number; rpe?: number },
  kind: ExerciseKind
): { emitted: string; parsed: boolean; error?: string } {
  const markdown = serializeSession(
    {
      id: 'session-mirror',
      routineId: 'routine-mirror',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: new Date('2026-01-01T01:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      customSyncStatus: 'pending',
    },
    [{ routineExerciseId: ROW_ID, exerciseId: EXERCISE_ID, setType: 'working' as SetType, position: 0, ...set }],
    [{ id: ROW_ID, exerciseId: EXERCISE_ID }],
    [{ id: EXERCISE_ID, title: 'Bench Press', kind }]
  );

  const emitted = markdown.split('\n').find((line) => line.trimStart().startsWith('- ')) ?? '';

  try {
    parseSession(markdown);
    return { emitted, parsed: true };
  } catch (error) {
    return { emitted, parsed: false, error: (error as Error).message };
  }
}

/** The presenter's own mapping (`sessionPresenter.ts` `onLogSet`), reproduced. */
function toSetRow(values: SetInputValues) {
  return {
    reps: values.reps,
    weightKg: values.weightLbs !== undefined ? lbsToKg(values.weightLbs) : undefined,
    durationSeconds: values.durationSeconds,
    rpe: values.rpe,
  };
}

type Case = { readonly label: string; readonly input: SetInputTexts; readonly kind: ExerciseKind };

const CASES: readonly Case[] = [
  {
    label: 'strength, reps and weight',
    input: { isDurationBased: false, repsText: '8', weightText: '135', durationText: '', rpe: undefined },
    kind: 'strength',
  },
  {
    label: 'strength, reps 0 (PR #89)',
    input: { isDurationBased: false, repsText: '0', weightText: '', durationText: '', rpe: undefined },
    kind: 'strength',
  },
  {
    label: 'strength, weight only — no reps slot',
    input: { isDurationBased: false, repsText: '', weightText: '135', durationText: '', rpe: undefined },
    kind: 'strength',
  },
  {
    label: 'strength, rpe only (the last-set popup path)',
    input: { isDurationBased: false, repsText: '', weightText: '', durationText: '', rpe: 8 },
    kind: 'strength',
  },
  {
    label: 'strength, everything blank',
    input: { isDurationBased: false, repsText: '', weightText: '', durationText: '', rpe: undefined },
    kind: 'strength',
  },
  {
    label: 'cardio, duration',
    input: { isDurationBased: true, repsText: '', weightText: '', durationText: '30', rpe: undefined },
    kind: 'cardio',
  },
  {
    label: 'cardio, duration 0',
    input: { isDurationBased: true, repsText: '', weightText: '', durationText: '0', rpe: undefined },
    kind: 'cardio',
  },
  {
    label: 'cardio, no duration',
    input: { isDurationBased: true, repsText: '8', weightText: '', durationText: '', rpe: undefined },
    kind: 'cardio',
  },
];

describe('buildLogSetValues mirrors buildSessionSetLine (#288)', () => {
  it.each(CASES.map((testCase) => [testCase.label, testCase] as const))(
    'the guard and the grammar agree: %s',
    (_label, testCase) => {
      const values = buildLogSetValues(testCase.input);

      // The whole contract in one line: the guard admits a set if and only if
      // the parser will take the line the serializer writes for it.
      if (values === undefined) {
        const asWritten = serializeThenParse(toSetRow({}), testCase.kind);
        expect([testCase.label, asWritten.parsed]).toEqual([testCase.label, false]);
        return;
      }

      const roundTrip = serializeThenParse(toSetRow(values), testCase.kind);
      expect([testCase.label, roundTrip.parsed, roundTrip.error]).toEqual([
        testCase.label,
        true,
        undefined,
      ]);
    }
  );

  it('exercises both outcomes, so the agreement above is not vacuous', () => {
    const admitted = CASES.filter((testCase) => buildLogSetValues(testCase.input) !== undefined);
    expect(admitted).toHaveLength(4);
    expect(CASES.length - admitted.length).toBe(4);
  });

  it('a rejected set is rejected by the parser for the reason #288 names', () => {
    // Pins the failure mode itself, not just that it fails: the strength line
    // is missing its `1x<reps>` slot and the cardio line its `duration=` flag.
    expect(serializeThenParse({}, 'strength').error).toMatch(/missing sets.*reps/i);
    expect(serializeThenParse({}, 'cardio').error).toMatch(/missing duration/i);
  });

  it('the serializer emits the bad line rather than throwing — the failure is silent', () => {
    // The correction to this PR's original severity claim, executed. If a
    // serializer-side guard is ever added (see the card), this goes red and
    // the AGENTS.md paragraph must be rewritten with it.
    const rejected = serializeThenParse({}, 'strength');
    expect(rejected.emitted).toContain('set_type=working');
    expect(rejected.emitted).not.toContain('1x');
    expect(rejected.parsed).toBe(false);
  });
});

/**
 * #305 — the second door, and the reason none of the `reps: 0` assertions in
 * `setInputs.test.ts` may be read as end-to-end.
 *
 * `engine/index.ts` converts `reps === 0`, `weightKg === 0` and
 * `durationSeconds === 0` to `undefined` on the way into Rill, using three
 * zero-sentinels that are not in `SENTINEL_TO_OPTION_MAP`. So a `reps: 0`
 * that this guard correctly admits is persisted with no measurement at all —
 * the #288 shape, reached through the engine instead of the form.
 *
 * Written as `it.failing`, not skipped, deliberately: it asserts the fix is
 * still missing, and it turns red the moment #305 lands, which is what makes
 * someone come back and delete the `.failing`.
 */
describe('reps: 0 survives to the database (#305 — currently it does not)', () => {
  async function persistThroughEngine(values: SetInputValues) {
    const persisted: Record<string, unknown>[] = [];

    const engine = createEngine({
      onCreateSession: jest.fn(),
      onScheduleRest: jest.fn(),
      onCancelRest: jest.fn(),
      onNotify: jest.fn(),
      onCompleteSession: jest.fn(),
      onDiscardSession: jest.fn(),
      onPersistSet: jest.fn((set: Record<string, unknown>) => {
        persisted.push(set);
      }),
    } as never);

    const idle: SessionState = {
      sessionId: 'session-305',
      routineId: 'routine-305',
      phase: 'idle',
      exerciseIndex: 0,
      setIndex: 0,
      supersetPosition: 0,
      restDeadlineMs: 0,
      loggedSets: [],
      lastLoggedSet: undefined,
      startedAtMs: 1000,
      prePausePhase: '',
      entries: [],
    };
    engine.setState(idle);

    await engine.dispatch({
      tag: 'StartSession',
      sessionId: 'session-305',
      nowMs: 1000,
      routine: {
        id: 'routine-305',
        entries: [
          {
            exerciseId: EXERCISE_ID,
            kind: 'strength',
            restSeconds: 60,
            supersetGroup: '',
            sets: [
              { setType: 'normal', reps: 8, durationSeconds: undefined },
              { setType: 'normal', reps: 8, durationSeconds: undefined },
            ],
          },
        ],
      },
    } as never);

    // The presenter's mapping, then the engine's own boundary conversion.
    await engine.dispatch({ tag: 'LogSet', ...toSetRow(values), nowMs: 10000 } as never);

    return persisted[0];
  }

  it.failing('a logged set of zero reps reaches onPersistSet as reps: 0', async () => {
    const values = buildLogSetValues({
      isDurationBased: false,
      repsText: '0',
      weightText: '',
      durationText: '',
      rpe: undefined,
    });
    // The guard's half of the contract holds today; the assertion below does not.
    expect(values).toEqual({ reps: 0 });

    const persisted = await persistThroughEngine(values!);
    expect(persisted).toMatchObject({ reps: 0 });
  });

  it('and because it does not, the row it writes is the #288 shape all over again', () => {
    // Green today, and it documents the live defect rather than the fix: the
    // erased set serializes to the same unexportable line the guard rejects.
    // This is what the simulator pass should see as "logs, but not 0 reps".
    const erased = serializeThenParse({ reps: undefined }, 'strength');
    expect(erased.parsed).toBe(false);
    expect(erased.error).toMatch(/missing sets.*reps/i);
  });
});
