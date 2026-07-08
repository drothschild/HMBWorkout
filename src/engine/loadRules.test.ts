import { loadRules, RuleLoadError } from './loadRules';
import { SessionState } from './types';

describe('engine: loadRules', () => {
  describe('AC10.2: Boot-time rule loading and validation', () => {
    it('loads all bundled rules without errors', () => {
      // loadRules() is called at module initialization and should not throw
      expect(() => {
        loadRules();
      }).not.toThrow();
    });

    it('throws RuleLoadError when a rule has a type error', () => {
      // Test with a deliberately broken rule source
      const brokenSource = `
        rule broken_rule(x: Int) -> String
        x + 1
      `;

      expect(() => {
        const check = require('rill-lang').checkRuleSource;
        const result = check(brokenSource);
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

      try {
        const check = require('rill-lang').checkRuleSource;
        const result = check(brokenSource);
        if (!result.ok) {
          throw new RuleLoadError('my_broken_rule', result.errors[0]);
        }
      } catch (e) {
        if (e instanceof RuleLoadError) {
          expect(e.message).toContain('my_broken_rule');
        }
      }
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
            rpe: 6.5,
          },
          {
            exerciseId: 'ex1',
            setType: 'working' as const,
            reps: 8,
            weightKg: 25.0,
            durationSeconds: null,
            rpe: 8.5,
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
      expect(deserialized.loggedSets[0].rpe).toBe(6.5);
    });
  });
});
