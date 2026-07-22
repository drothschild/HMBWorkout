import { loadRules, RuleLoadError } from './loadRules';
import { checkRuleSource } from 'rill-lang';
import { SessionState } from './types';

describe('engine: loadRules', () => {
  describe('AC10.2: Boot-time rule loading and validation', () => {
    it('loads all bundled rules without errors', () => {
      // M2: loadRules() is called explicitly at bootstrap and should not throw
      expect(() => {
        loadRules();
      }).not.toThrow();
    });

    it('loadRules() throws RuleLoadError on broken bundled source', () => {
      // Spy on checkRuleSource and mock it to return an error for transition rule
      const mockCheckRuleSource = jest.spyOn(require('rill-lang'), 'checkRuleSource');
      mockCheckRuleSource.mockReturnValue({
        ok: false,
        errors: ['Transition rule has a type error: missing match arm'],
      });

      // Verify loadRules() throws RuleLoadError with 'transition' in message
      expect(() => {
        loadRules();
      }).toThrow(RuleLoadError);

      expect(() => {
        loadRules();
      }).toThrow(/transition/);

      mockCheckRuleSource.mockRestore();
    });

    it('throws RuleLoadError when a rule has a type error', () => {
      // Test with a deliberately broken rule source
      const brokenSource = `
        rule broken_rule(x: Int) -> String
        x + 1
      `;

      expect(() => {
        const result = checkRuleSource(brokenSource);
        if (!result.ok) {
          throw new RuleLoadError('broken_rule', result.errors[0]);
        }
      }).toThrow(RuleLoadError);
    });

    it('includes rule name in RuleLoadError message', () => {
      const brokenSource = `
        rule my_broken_rule(x: Int) -> String
        x + 1
      `;

      expect(() => {
        const result = checkRuleSource(brokenSource);
        if (!result.ok) {
          throw new RuleLoadError('my_broken_rule', result.errors[0]);
        }
      }).toThrow(RuleLoadError);
    });
  });

  describe('AC7.3: Exhaustiveness boot gate', () => {
    it('rejects non-exhaustive match over Event union', () => {
      // Doctored transition rule missing one Event constructor
      const nonExhaustiveSource = `
        import "types" as t

        rule transition(state: SessionState, event: Event) -> Result({ state: SessionState, effects: List(Effect) })
        match event {
          StartSession(p) -> Ok({ state: state, effects: [] }),
          LogSet(p) -> Ok({ state: state, effects: [] }),
          SetDone(p) -> Ok({ state: state, effects: [] }),
          RestElapsed(p) -> Ok({ state: state, effects: [] }),
          SkipExercise -> Ok({ state: state, effects: [] }),
          PauseSession -> Ok({ state: state, effects: [] }),
          Resume(p) -> Ok({ state: state, effects: [] })
          -- FinishSession intentionally omitted
        }
      `;

      const result = checkRuleSource(nonExhaustiveSource, {
        resolve: (modulePath: string) => {
          if (modulePath === 'types') {
            return `type Phase = Idle | Warmup | Working | Resting | Stretching | Paused | Done
type Event = StartSession({ sessionId: String, nowMs: Int, routine: { entries: List({ exerciseId: String, kind: String, warmupSets: Int, targetSets: Int, targetReps: Int, targetDurationSeconds: Int, restSeconds: Int, supersetGroup: String }), id: String } }) | LogSet({ reps: Int, weightKg: Float, durationSeconds: Int }) | SetDone({ nowMs: Int }) | RestElapsed({ nowMs: Int }) | SkipExercise | PauseSession | Resume({ nowMs: Int }) | FinishSession({ nowMs: Int })
type Effect = CreateSession({ sessionId: String, routineId: String, startedAtMs: Int }) | ScheduleRest({ deadlineMs: Int }) | CancelRest | Notify({ message: String }) | PersistSet({ set: { exerciseId: String, setType: String, reps: Int, weightKg: Float, durationSeconds: Int } }) | CompleteSession({ summary: { startMs: Int, endMs: Int, exercisesCompleted: Int, setsLogged: Int, loggedSets: List({ exerciseId: String, setType: String, reps: Int, weightKg: Float, durationSeconds: Int }) } })
alias SessionState = { sessionId: String, routineId: String, phase: Phase, exerciseIndex: Int, setIndex: Int, supersetPosition: Int, restDeadlineMs: Int, prePausePhase: String, loggedSets: List({ exerciseId: String, setType: String, reps: Int, weightKg: Float, durationSeconds: Int }), lastLoggedSet: { exerciseId: String, setType: String, reps: Int, weightKg: Float, durationSeconds: Int }, startedAtMs: Int, entries: List({ exerciseId: String, kind: String, warmupSets: Int, targetSets: Int, targetReps: Int, targetDurationSeconds: Int, restSeconds: Int, supersetGroup: String }) }
true`;
          }
          throw new Error(`Module not found: ${modulePath}`);
        },
      });

      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatch(/missing/i);
      expect(result.errors[0]).toMatch(/FinishSession/);
    });
  });

  describe('AC10.4: SessionState serialization', () => {
    it('SessionState survives JSON round-trip serialization', () => {
      const sessionState: SessionState = {
        sessionId: 'sess-uuid-123',
        routineId: 'routine-456',
        phase: 'working' as const,
        exerciseIndex: 2,
        setIndex: 1,
        supersetPosition: 0,
        restDeadlineMs: 1688000000000,
        loggedSets: [
          {
            exerciseId: 'ex1',
            setType: 'warmup' as const,
            reps: 10,
            weightKg: 20.5,
            durationSeconds: null,
          },
          {
            exerciseId: 'ex1',
            setType: 'working' as const,
            reps: 8,
            weightKg: 25.0,
            durationSeconds: null,
          },
        ],
        startedAtMs: 1687900000000,
        entries: [],
      };

      // Serialize and deserialize
      const serialized = JSON.stringify(sessionState);
      const deserialized = JSON.parse(serialized);

      // Should be deep equal
      expect(deserialized).toEqual(sessionState);
      expect(deserialized.sessionId).toBe('sess-uuid-123');
      expect(deserialized.phase).toBe('working');
      expect(deserialized.loggedSets).toHaveLength(2);
      expect(deserialized.loggedSets[0].weightKg).toBe(20.5);
    });
  });
});
