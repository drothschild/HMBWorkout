import {
  parseAiTurn,
  validateRoutineDraft,
  validateSettingsProposal,
  slugifyTitle,
  DraftValidationError,
  AI_TURN_SCHEMA,
  SETTINGS_FIELD_MAX_LENGTH,
} from './draftSchema';
import { expectStructuredOutputSafe } from './structuredOutputSubset';

describe('draftSchema', () => {
  describe('parseAiTurn', () => {
    test('parses valid JSON with reply and draft', () => {
      const json = JSON.stringify({
        reply: 'Here is your routine',
        draft: {
          name: 'My Routine',
          exercises: [
            { title: 'Bench Press', kind: 'strength', sets: [{ type: 'normal' }] },
          ],
        },
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Here is your routine');
      expect(result.draft).toBeDefined();
      expect(result.draft?.name).toBe('My Routine');
      expect(result.draft?.exercises).toHaveLength(1);
    });

    test('parses valid JSON with reply only', () => {
      const json = JSON.stringify({ reply: 'Just a reply' });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Just a reply');
      expect(result.draft).toBeUndefined();
    });

    test('throws DraftValidationError on non-JSON text', () => {
      expect(() => parseAiTurn('not json')).toThrow(DraftValidationError);
    });

    test('throws DraftValidationError when reply is missing', () => {
      const json = JSON.stringify({ draft: {} });

      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
    });

    test('throws DraftValidationError when reply is not a string', () => {
      const json = JSON.stringify({ reply: 123 });

      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
    });

    test('throws DraftValidationError when draft is invalid', () => {
      const json = JSON.stringify({
        reply: 'reply',
        draft: { name: '', exercises: [] }, // empty name
      });

      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
    });

    test('parses a turn carrying a settings proposal', () => {
      const json = JSON.stringify({
        reply: 'Want me to update your equipment?',
        settingsProposal: { equipment: 'Dumbbells and a pull-up bar' },
      });

      const result = parseAiTurn(json);

      expect(result.settingsProposal).toEqual({ equipment: 'Dumbbells and a pull-up bar' });
      expect(result.draft).toBeUndefined();
    });

    test('leaves settingsProposal undefined when the turn omits it', () => {
      const json = JSON.stringify({ reply: 'Just a reply' });

      expect(parseAiTurn(json).settingsProposal).toBeUndefined();
    });

    test('parses a turn carrying both a draft and a settings proposal', () => {
      const json = JSON.stringify({
        reply: 'Here is a routine, and a goals update to match',
        draft: {
          name: 'My Routine',
          exercises: [{ title: 'Bench Press', kind: 'strength', sets: [{ type: 'normal' }] }],
        },
        settingsProposal: { goals: 'Build strength' },
      });

      const result = parseAiTurn(json);

      expect(result.draft?.name).toBe('My Routine');
      expect(result.settingsProposal).toEqual({ goals: 'Build strength' });
    });

    test('treats an empty settingsProposal as absent and keeps the reply', () => {
      // An empty settingsProposal object is semantically equivalent to no proposal:
      // all fields are undefined. parseAiTurn drops it to preserve the reply, and
      // validateSettingsProposal throws if called directly on an empty proposal.
      const json = JSON.stringify({
        reply: 'reply',
        settingsProposal: {}, // all fields undefined
      });

      const result = parseAiTurn(json);
      expect(result.reply).toBe('reply');
      expect(result.settingsProposal).toBeUndefined();
    });

    test('parses OpenAI-style response with null draft and settingsProposal', () => {
      const json = JSON.stringify({
        reply: 'Here is your routine',
        draft: null,
        settingsProposal: null,
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Here is your routine');
      expect(result.draft).toBeUndefined();
      expect(result.settingsProposal).toBeUndefined();
    });

    test('parses OpenAI-style response with draft containing null optional fields', () => {
      const json = JSON.stringify({
        reply: 'Here is your routine',
        draft: {
          name: 'My Routine',
          notes: null,
          exercises: [
            {
              title: 'Bench Press',
              kind: 'strength',
              sets: [{ type: 'normal' }],
              supersetGroup: null,
              description: null,
            },
          ],
        },
        settingsProposal: null,
      });

      const result = parseAiTurn(json);

      expect(result.draft?.name).toBe('My Routine');
      expect(result.draft?.notes).toBeUndefined();
      expect(result.draft?.exercises[0].supersetGroup).toBeUndefined();
      expect(result.draft?.exercises[0].description).toBeUndefined();
    });

    test('parses OpenAI-style response with settingsProposal containing null fields', () => {
      const json = JSON.stringify({
        reply: 'Want me to update your equipment?',
        draft: null,
        settingsProposal: {
          goals: 'Build strength',
          equipment: null,
          personality: null,
        },
      });

      const result = parseAiTurn(json);

      expect(result.settingsProposal).toEqual({ goals: 'Build strength' });
      expect(result.settingsProposal?.equipment).toBeUndefined();
      expect(result.settingsProposal?.personality).toBeUndefined();
    });

    test('still works with Anthropic-style response (fields absent, not null)', () => {
      const json = JSON.stringify({
        reply: 'Here is your routine',
        draft: {
          name: 'My Routine',
          exercises: [{ title: 'Bench Press', kind: 'strength', sets: [{ type: 'normal' }] }],
        },
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Here is your routine');
      expect(result.draft?.name).toBe('My Routine');
      expect(result.draft?.notes).toBeUndefined();
    });

    test('rejects __proto__ injection in draft (prevents prototype pollution bypass of validation)', () => {
      // Craft a JSON string with __proto__ as a key in the draft object.
      // When parsed, __proto__ is a regular property (JSON doesn't treat it specially).
      // The normalizer must place __proto__ as an own data property, not on the prototype.
      // Omit own name/exercises keys so the fixture actually tests the __proto__ injection.
      const json = '{"reply":"x","draft":{"__proto__":{"name":"Injected","exercises":[{"title":"E","kind":"strength"}]}}}';

      // The normalizer must use Object.defineProperty to place __proto__ as an own
      // property, not allow it to hit the prototype setter. If it did, validation
      // would see draft.name === "Injected" and pass, which is wrong.
      // Without the own-property guard, the __proto__ would inject into the prototype
      // and validation would find a name through the inheritance chain.
      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
      expect(() => parseAiTurn(json)).toThrow('routine name is required');
    });

    test('treats an all-null settingsProposal as absent (drop empty proposal, keep reply)', () => {
      const json = JSON.stringify({
        reply: 'Check your goals?',
        settingsProposal: {
          goals: null,
          equipment: null,
          personality: null,
        },
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Check your goals?');
      expect(result.settingsProposal).toBeUndefined();
    });

    test('coach-onboarding.AC2.4: treats an all-null six-field proposal as absent', () => {
      // This exact shape is what an OpenAI install puts on the wire on every
      // turn where the model declines to propose anything: transformSchemaForOpenAI
      // makes all six `required` with type ['string','null'], so the nulls are
      // not hypothetical. The pre-existing null tests cover only the old three.
      const json = JSON.stringify({
        reply: 'Nothing to change.',
        settingsProposal: {
          goals: null,
          equipment: null,
          personality: null,
          age: null,
          experience: null,
        },
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Nothing to change.');
      expect(result.settingsProposal).toBeUndefined();
    });

    test('coach-onboarding.AC2.4: a proposal whose only real field is a new one survives normalization', () => {
      const json = JSON.stringify({
        reply: 'Noted.',
        settingsProposal: {
          goals: null,
          equipment: null,
          personality: null,
          age: '41',
          experience: null,
        },
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('Noted.');
      expect(result.settingsProposal).toEqual({ age: '41' });
    });

    test('preserves a settingsProposal with at least one real field through normalization', () => {
      const json = JSON.stringify({
        reply: 'Check your goals?',
        settingsProposal: {
          goals: 'Build strength',
          equipment: null,
          personality: null,
        },
      });

      const result = parseAiTurn(json);

      expect(result.settingsProposal).toEqual({ goals: 'Build strength' });
      expect(result.settingsProposal?.equipment).toBeUndefined();
      expect(result.settingsProposal?.personality).toBeUndefined();
    });

    test('issue-191: pins empty string in goals throws from parseAiTurn, not silently dropped', () => {
      // { goals: '' } should throw from parseAiTurn because validateSettingsProposal
      // rejects empty/whitespace-only strings. This guards against the behavior
      // flipping to silently drop it as if goals were undefined.
      const json = JSON.stringify({
        reply: 'reply',
        settingsProposal: { goals: '' },
      });

      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
      expect(() => parseAiTurn(json)).toThrow('goals, when present, must be a non-empty string');
    });

    test('issue-191: pins empty array settingsProposal silently dropped (treated as empty proposal)', () => {
      // An empty array [] for settingsProposal is treated as if it has no fields
      // and is silently dropped, keeping the reply. This guards against the behavior
      // flipping to either throw or treat the array as a valid proposal.
      const json = JSON.stringify({
        reply: 'reply',
        settingsProposal: [],
      });

      const result = parseAiTurn(json);

      expect(result.reply).toBe('reply');
      expect(result.settingsProposal).toBeUndefined();
    });
  });

  describe('validateSettingsProposal', () => {
    test('accepts a goals-only proposal', () => {
      const proposal = { goals: 'Run a 5k under 25 minutes' };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('accepts an equipment-only proposal', () => {
      const proposal = { equipment: 'Adjustable dumbbells, pull-up bar' };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('accepts a personality-only proposal', () => {
      const proposal = { personality: 'Direct and no-nonsense; celebrate PRs' };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('accepts a proposal carrying both goals and equipment', () => {
      const proposal = { goals: 'Hypertrophy', equipment: 'Full commercial gym' };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('accepts a proposal carrying all three fields', () => {
      const proposal = {
        goals: 'Hypertrophy',
        equipment: 'Full commercial gym',
        personality: 'Upbeat hype coach',
      };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('rejects non-object', () => {
      expect(() => validateSettingsProposal('goals')).toThrow(DraftValidationError);
      expect(() => validateSettingsProposal(null)).toThrow(DraftValidationError);
      expect(() => validateSettingsProposal(42)).toThrow(DraftValidationError);
    });

    test('throws when called directly with an empty proposal object', () => {
      // Empty proposals are dropped by parseAiTurn before validateSettingsProposal is called.
      // If validateSettingsProposal is called directly on an empty proposal (as a layer-2
      // defense), it must reject it cleanly, not crash or silently accept it.
      expect(() => validateSettingsProposal({})).toThrow(DraftValidationError);
      expect(() => validateSettingsProposal({})).toThrow('at least one field');
    });

    test('throws when called directly with all fields undefined', () => {
      // Same layer-2 defense: the validator must reject empty proposals.
      expect(() =>
        validateSettingsProposal({
          goals: undefined,
          equipment: undefined,
          personality: undefined,
        })
      ).toThrow(DraftValidationError);
      expect(() =>
        validateSettingsProposal({
          goals: undefined,
          equipment: undefined,
          personality: undefined,
        })
      ).toThrow('at least one field');
    });

    test('rejects non-string goals', () => {
      expect(() => validateSettingsProposal({ goals: 42 })).toThrow(DraftValidationError);
    });

    test('rejects non-string equipment', () => {
      expect(() => validateSettingsProposal({ equipment: ['dumbbells'] })).toThrow(
        DraftValidationError
      );
    });

    test('rejects non-string personality', () => {
      expect(() => validateSettingsProposal({ personality: 42 })).toThrow(
        'personality, when present, must be a non-empty string'
      );
    });

    test('rejects whitespace-only goals', () => {
      expect(() => validateSettingsProposal({ goals: '   ' })).toThrow(DraftValidationError);
    });

    test('rejects whitespace-only equipment', () => {
      expect(() => validateSettingsProposal({ equipment: '\n\t' })).toThrow(DraftValidationError);
    });

    test('rejects whitespace-only personality', () => {
      expect(() => validateSettingsProposal({ personality: '   ' })).toThrow(
        'personality, when present, must be a non-empty string'
      );
    });

    test('rejects goals longer than the field maximum', () => {
      const goals = 'g'.repeat(SETTINGS_FIELD_MAX_LENGTH + 1);

      expect(() => validateSettingsProposal({ goals })).toThrow(DraftValidationError);
    });

    test('rejects equipment longer than the field maximum', () => {
      const equipment = 'e'.repeat(SETTINGS_FIELD_MAX_LENGTH + 1);

      expect(() => validateSettingsProposal({ equipment })).toThrow(DraftValidationError);
    });

    test('rejects personality longer than the field maximum', () => {
      const personality = 'p'.repeat(SETTINGS_FIELD_MAX_LENGTH + 1);

      expect(() => validateSettingsProposal({ personality })).toThrow(
        `personality must be at most ${SETTINGS_FIELD_MAX_LENGTH} characters, got ${
          SETTINGS_FIELD_MAX_LENGTH + 1
        }`
      );
    });

    test('accepts a field exactly at the field maximum', () => {
      const goals = 'g'.repeat(SETTINGS_FIELD_MAX_LENGTH);

      expect(validateSettingsProposal({ goals }).goals).toBe(goals);
    });

    test('coach-onboarding.AC2.1 Success: age-only proposal validates and round-trips', () => {
      const proposal = { age: '41' };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('coach-onboarding.AC2.1 Success: experience-only proposal validates and round-trips', () => {
      const proposal = { experience: '5 years of weight training' };

      expect(validateSettingsProposal(proposal)).toEqual(proposal);
    });

    test('coach-onboarding.AC2.3 Failure: age with empty string is rejected', () => {
      expect(() => validateSettingsProposal({ age: '' })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: age with whitespace-only is rejected', () => {
      expect(() => validateSettingsProposal({ age: '   ' })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: age with non-string is rejected', () => {
      expect(() => validateSettingsProposal({ age: 42 })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: age exceeding max length is rejected', () => {
      const age = 'a'.repeat(SETTINGS_FIELD_MAX_LENGTH + 1);

      expect(() => validateSettingsProposal({ age })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: experience with empty string is rejected', () => {
      expect(() => validateSettingsProposal({ experience: '' })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: experience with whitespace-only is rejected', () => {
      expect(() => validateSettingsProposal({ experience: '\n\t' })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: experience with non-string is rejected', () => {
      expect(() => validateSettingsProposal({ experience: true })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.3 Failure: experience exceeding max length is rejected', () => {
      const experience = 'e'.repeat(SETTINGS_FIELD_MAX_LENGTH + 1);

      expect(() => validateSettingsProposal({ experience })).toThrow(DraftValidationError);
    });

    test('coach-onboarding.AC2.4 Edge: all six fields undefined is rejected as empty', () => {
      expect(() =>
        validateSettingsProposal({
          goals: undefined,
          equipment: undefined,
          personality: undefined,
          age: undefined,
          experience: undefined,
        })
      ).toThrow(DraftValidationError);
      expect(() =>
        validateSettingsProposal({
          goals: undefined,
          equipment: undefined,
          personality: undefined,
          age: undefined,
          experience: undefined,
        })
      ).toThrow('at least one field');
    });
  });

  describe('validateRoutineDraft', () => {
    test('accepts minimal valid draft', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const , sets: [{ type: 'normal' as const }] }],
      };

      const result = validateRoutineDraft(draft);

      expect(result).toEqual(draft);
    });

    test('accepts fully-populated draft', () => {
      const draft = {
        name: 'My Routine',
        notes: 'Some notes',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            supersetGroup: 'chest',
            warmupSets: 1,
            targetSets: 3,
            targetReps: 8,
            targetDurationSeconds: undefined,
            restSeconds: 60,
            notes: 'exercise notes',
          },
        ],
      };

      const result = validateRoutineDraft(draft);

      expect(result).toEqual(draft);
    });

    test('rejects non-object', () => {
      expect(() => validateRoutineDraft('not an object')).toThrow(DraftValidationError);
      expect(() => validateRoutineDraft(null)).toThrow(DraftValidationError);
      expect(() => validateRoutineDraft(123)).toThrow(DraftValidationError);
    });

    test('rejects missing name', () => {
      const draft = { exercises: [] };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects empty name', () => {
      const draft = { name: '', exercises: [] };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects missing exercises array', () => {
      const draft = { name: 'My Routine' };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects empty exercises array', () => {
      const draft = { name: 'My Routine', exercises: [] };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects exercise missing title', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ kind: 'strength' } as any],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects exercise with empty title', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: '', kind: 'strength' as const , sets: [{ type: 'normal' as const }] }],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects exercise title that slugifies to empty', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: '!!!', kind: 'strength' as const , sets: [{ type: 'normal' as const }] }],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects invalid exercise kind', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'yoga' as any }],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    // #276 Phase 4: `targetSets` and `warmupSets` have no per-set counterpart
    // — the set count IS the list's length and its warmup partition — so the
    // two tests that pinned their bounds are replaced by the shape rule that
    // took over their job, in the per-set describe below (AC4.6). `targetReps`
    // and `targetDurationSeconds` moved to the set and keep their bounds here.
    test('rejects non-number set reps', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, reps: 'ten' as any }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-number set durationSeconds', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Running',
            kind: 'cardio' as const,
            sets: [{ type: 'normal' as const, durationSeconds: 'thirty' as any }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-number restSeconds', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            restSeconds: 'sixty' as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-string routine notes', () => {
      const draft = {
        name: 'My Routine',
        notes: { a: 1 } as any,
        exercises: [{ title: 'Bench Press', kind: 'strength' as const , sets: [{ type: 'normal' as const }] }],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-string supersetGroup', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            supersetGroup: 99 as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-string exercise notes', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            notes: { a: 1 } as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects fractional set reps', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, reps: 2.7 }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects negative restSeconds', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            restSeconds: -60,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects zero set reps', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, reps: 0 }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('accepts routine-level notes', () => {
      const draft = {
        name: 'My Routine',
        notes: 'My notes',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const , sets: [{ type: 'normal' as const }] }],
      };

      const result = validateRoutineDraft(draft);
      expect(result.notes).toBe('My notes');
    });

    test('accepts exercise-level notes', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            notes: 'Exercise notes',
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0].notes).toBe('Exercise notes');
    });

    test('accepts valid supersetGroup', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            supersetGroup: 'chest',
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0].supersetGroup).toBe('chest');
    });

    test('accepts valid integer values', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const }],
            warmupSets: 1,
            targetSets: 3,
            targetReps: 8,
            restSeconds: 60,
            targetDurationSeconds: 0,
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0]).toMatchObject({
        warmupSets: 1,
        targetSets: 3,
        targetReps: 8,
        restSeconds: 60,
        targetDurationSeconds: 0,
      });
    });

    test('accepts an exercise with a description string', () => {
      const draft = {
        name: 'Cooldown',
        exercises: [
          {
            title: 'Pigeon Stretch (Left)',
            kind: 'stretch' as const,
            sets: [{ type: 'normal' as const }],
            targetDurationSeconds: 30,
            description: 'From all fours, bring the left shin forward and lower the hips toward the floor.',
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0].description).toBe(
        'From all fours, bring the left shin forward and lower the hips toward the floor.'
      );
    });

    test('rejects a non-string exercise description', () => {
      const draft = {
        name: 'Cooldown',
        exercises: [
          { title: 'Pigeon Stretch', kind: 'stretch' as const, description: 42 },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
      expect(() => validateRoutineDraft(draft)).toThrow(
        'exercise description, when present, must be a string'
      );
    });

    // coach-prescribed-weights.AC2.1: Success — accepts 185
    test('coach-prescribed-weights.AC2.1 (per-set, #276): accepts weightLbs: 185', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 185 }],
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0].sets[0].weightLbs).toBe(185);
    });

    // coach-prescribed-weights.AC2.2: Success — accepts 187.5 (half-pound)
    test('coach-prescribed-weights.AC2.2 (per-set, #276): accepts weightLbs: 187.5 (half-pound)', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 187.5 }],
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0].sets[0].weightLbs).toBe(187.5);
    });

    // coach-prescribed-weights.AC2.3: Failure — rejects 0
    test('coach-prescribed-weights.AC2.3 (per-set, #276): rejects weightLbs: 0', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 0 }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    // coach-prescribed-weights.AC2.4: Failure — rejects negative
    test('coach-prescribed-weights.AC2.4 (per-set, #276): rejects weightLbs: -5', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: -5 }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    // coach-prescribed-weights.AC2.5: Failure — rejects off the 0.5 grid
    test('coach-prescribed-weights.AC2.5 (per-set, #276): rejects weightLbs: 185.3 (off 0.5 grid)', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 185.3 }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    // coach-prescribed-weights.AC2.5 discriminator: rejects 0.25lb (quarter-pound) grid
    // This fixture catches mutations that loosen the grid to quarter-pounds.
    // 185.25 -> 84.03kg -> 185.5 (broken round-trip if grid is 0.25)
    // Fixture must discriminate the exact 0.5 grid, not just "some decimal off"
    test('coach-prescribed-weights.AC2.5 (per-set, #276): rejects weightLbs: 185.25 (quarter-pound, off 0.5 grid)', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 185.25 }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    // coach-prescribed-weights.AC2.6: Failure — rejects non-number
    test('coach-prescribed-weights.AC2.6 (per-set, #276): rejects weightLbs as string', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: '185' as unknown as number }],
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    // Edge case — omitting the load is valid
    test('accepts a set omitting weightLbs', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, reps: 8 }],
          },
        ],
      };

      const result = validateRoutineDraft(draft);
      expect(result.exercises[0].sets[0].weightLbs).toBeUndefined();
    });

    // AC2.1-2.6 scope: guard must apply to all exercises, not just exercises[0]
    // Regression: guard scoped to exercises[0] passes all 112 tests. This fixture
    // catches that scoping bug by placing the invalid weight on the second exercise.
    test('coach-prescribed-weights.AC2.1-6: rejects invalid weight on non-first exercise', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 185 }],
          },
          {
            title: 'Incline Press',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, weightLbs: 0 }], // Invalid: zero
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });
  });

  // #276 Phase 4. The set list is the draft's whole prescription: an exercise
  // says what to do set by set, and the aggregate counts it used to carry are
  // gone. RAMP is the discriminating fixture — the aggregate model literally
  // cannot hold three warmups at three different loads.
  describe('validateRoutineDraft: per-set drafts (AC4.2 – AC4.6)', () => {
    /** Bench Press (Dumbbell) as the coach drafts it: pounds, never kg. */
    const RAMP_SETS = [
      { type: 'warmup' as const, reps: 5, weightLbs: 20 },
      { type: 'warmup' as const, reps: 5, weightLbs: 25 },
      { type: 'warmup' as const, reps: 3, weightLbs: 40 },
      { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
      { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
      { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
      { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
    ];

    const withSets = (sets: unknown) => ({
      name: 'Push Day',
      exercises: [{ title: 'Bench Press', kind: 'strength' as const, sets }],
    });

    test('AC4.2: accepts RAMP — three ascending warmups, then four working sets', () => {
      const draft = withSets(RAMP_SETS);

      const result = validateRoutineDraft(draft);

      // Not just "it validated": the three warmup loads must survive DISTINCT
      // and in order. A validator that normalised the list to counts would
      // return one weight here, and the whole point of the phase is lost.
      expect(result.exercises[0].sets.filter((set) => set.type === 'warmup')).toEqual([
        { type: 'warmup', reps: 5, weightLbs: 20 },
        { type: 'warmup', reps: 5, weightLbs: 25 },
        { type: 'warmup', reps: 3, weightLbs: 40 },
      ]);
      expect(result.exercises[0].sets.filter((set) => set.type === 'normal')).toHaveLength(4);
    });

    test('AC4.3: accepts RANGE (reps 8, repsMax 10)', () => {
      const result = validateRoutineDraft(withSets([{ type: 'normal', reps: 8, repsMax: 10 }]));

      expect(result.exercises[0].sets[0]).toEqual({ type: 'normal', reps: 8, repsMax: 10 });
    });

    test('AC4.3: rejects repsMax below reps', () => {
      expect(() => validateRoutineDraft(withSets([{ type: 'normal', reps: 10, repsMax: 8 }]))).toThrow(
        DraftValidationError
      );
    });

    test('AC4.3: accepts repsMax equal to reps (Hevy emits exact ranges that way)', () => {
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', reps: 5, repsMax: 5 }]))
      ).not.toThrow();
    });

    test('AC4.3: rejects a repsMax with no reps under it', () => {
      // A range's top with no bottom is not a range, and nothing downstream can
      // render it: plannedSetsFormat reads repsMax only when reps is present.
      expect(() => validateRoutineDraft(withSets([{ type: 'normal', repsMax: 10 }]))).toThrow(
        DraftValidationError
      );
    });

    test('AC4.4: rejects a set type that is neither warmup nor normal', () => {
      // 'working' is the SESSION's vocabulary (session_sets.set_type), not the
      // plan's — the likeliest wrong answer, so it is the one pinned.
      expect(() => validateRoutineDraft(withSets([{ type: 'working' }]))).toThrow(
        DraftValidationError
      );
      expect(() => validateRoutineDraft(withSets([{ type: 'drop' }]))).toThrow(
        DraftValidationError
      );
      expect(() => validateRoutineDraft(withSets([{}]))).toThrow(DraftValidationError);
      expect(() => validateRoutineDraft(withSets([{ type: 5 }]))).toThrow(DraftValidationError);
    });

    test('AC4.5: rejects a zero, negative or off-grid weightLbs, per set', () => {
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', weightLbs: 0 }]))
      ).toThrow(DraftValidationError);
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', weightLbs: -50 }]))
      ).toThrow(DraftValidationError);
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', weightLbs: 50.25 }]))
      ).toThrow(DraftValidationError);
    });

    test('AC4.5: the bound is applied to EVERY set, not only the first', () => {
      // The mutation this kills: a loop that validates sets[0] and returns.
      expect(() =>
        validateRoutineDraft(
          withSets([
            { type: 'warmup', weightLbs: 20 },
            { type: 'normal', weightLbs: 50.25 },
          ])
        )
      ).toThrow(DraftValidationError);
    });

    test('AC4.5: accepts a half-pound load', () => {
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', weightLbs: 187.5 }]))
      ).not.toThrow();
    });

    test('AC4.6: rejects an exercise with an empty set list', () => {
      // `minItems` is on UNSUPPORTED_SCHEMA_KEYWORDS and 400s the whole
      // request, so this validator is the ONLY layer that can enforce it.
      // Without it a drafted empty exercise reaches the engine as an entry
      // h.next_active_landing can never land on.
      expect(() => validateRoutineDraft(withSets([]))).toThrow(DraftValidationError);
    });

    test('AC4.6: rejects an exercise with no set list at all', () => {
      expect(() =>
        validateRoutineDraft({
          name: 'Push Day',
          exercises: [{ title: 'Bench Press', kind: 'strength' }],
        })
      ).toThrow(DraftValidationError);
    });

    test('AC4.6: rejects a set list that is not an array', () => {
      expect(() => validateRoutineDraft(withSets({ type: 'normal' }))).toThrow(
        DraftValidationError
      );
      expect(() => validateRoutineDraft(withSets('3x8'))).toThrow(DraftValidationError);
    });

    test('AC4.6: rejects a non-object inside the set list', () => {
      expect(() => validateRoutineDraft(withSets([null]))).toThrow(DraftValidationError);
      expect(() => validateRoutineDraft(withSets(['warmup']))).toThrow(DraftValidationError);
    });

    test('rejects reps below 1 or non-integer, per set', () => {
      expect(() => validateRoutineDraft(withSets([{ type: 'normal', reps: 0 }]))).toThrow(
        DraftValidationError
      );
      expect(() => validateRoutineDraft(withSets([{ type: 'normal', reps: -1 }]))).toThrow(
        DraftValidationError
      );
      expect(() => validateRoutineDraft(withSets([{ type: 'normal', reps: 8.5 }]))).toThrow(
        DraftValidationError
      );
    });

    test('rejects repsMax below 1 or non-integer', () => {
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', reps: 1, repsMax: 1.5 }]))
      ).toThrow(DraftValidationError);
    });

    test('rejects a negative durationSeconds but accepts zero', () => {
      // >= 0, the bound targetDurationSeconds carried before this phase,
      // transported to the set.
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', durationSeconds: -1 }]))
      ).toThrow(DraftValidationError);
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', durationSeconds: 0 }]))
      ).not.toThrow();
      expect(() =>
        validateRoutineDraft(withSets([{ type: 'normal', durationSeconds: 45.5 }]))
      ).toThrow(DraftValidationError);
    });

    test('a bare set with only its type is a complete, valid set', () => {
      // Every prescribed field is independently optional (AC5.8's rule, one
      // layer up): "do one working set" is a real instruction.
      expect(() => validateRoutineDraft(withSets([{ type: 'normal' }]))).not.toThrow();
      expect(() => validateRoutineDraft(withSets([{ type: 'warmup' }]))).not.toThrow();
    });

    test('applies the per-set bounds to EVERY exercise, not only the first', () => {
      expect(() =>
        validateRoutineDraft({
          name: 'Push Day',
          exercises: [
            { title: 'Bench Press', kind: 'strength', sets: [{ type: 'normal', reps: 8 }] },
            { title: 'Incline Press', kind: 'strength', sets: [] },
          ],
        })
      ).toThrow(DraftValidationError);
    });
  });

  describe('slugifyTitle', () => {
    test('converts to lowercase', () => {
      expect(slugifyTitle('Bench Press')).toBe('bench-press');
    });

    test('replaces spaces with hyphens', () => {
      expect(slugifyTitle('Bench Press DB')).toBe('bench-press-db');
    });

    test('removes special characters', () => {
      expect(slugifyTitle('Push-ups & Pull-ups!')).toBe('push-ups-pull-ups');
    });

    test('trims whitespace', () => {
      expect(slugifyTitle('  Bench Press  ')).toBe('bench-press');
    });

    test('removes leading/trailing hyphens', () => {
      expect(slugifyTitle('---Bench Press---')).toBe('bench-press');
    });

    test('returns empty string for non-alphanumeric', () => {
      expect(slugifyTitle('!!!')).toBe('');
    });

    test('converts multiple consecutive special chars to single hyphen', () => {
      expect(slugifyTitle('Bench   Press')).toBe('bench-press');
    });
  });

  describe('AI_TURN_SCHEMA', () => {
    // The same guard `ALTERNATES_SCHEMA` carries, for the same reason and with
    // a wider blast radius: an unsupported keyword anywhere in here is a 400 on
    // every conversational turn, so the whole coach stops answering rather than
    // one button failing. Bounds belong in `validateRoutineDraft`, which is
    // where the ones enforced today already live.
    test('carries no keyword the structured-output schema subset rejects', () => {
      expectStructuredOutputSafe(AI_TURN_SCHEMA);
    });

    test('has additionalProperties false on root object', () => {
      expect(AI_TURN_SCHEMA.additionalProperties).toBe(false);
    });

    test('has additionalProperties false on draft object', () => {
      const draftSchema = (AI_TURN_SCHEMA.properties as any).draft;
      expect(draftSchema.additionalProperties).toBe(false);
    });

    test('has additionalProperties false on exercise items', () => {
      const draftSchema = (AI_TURN_SCHEMA.properties as any).draft;
      const exerciseSchema = draftSchema.properties.exercises.items;
      expect(exerciseSchema.additionalProperties).toBe(false);
    });

    test('requires reply at root level', () => {
      expect(AI_TURN_SCHEMA.required).toContain('reply');
    });

    test('does not require draft at root level', () => {
      expect(AI_TURN_SCHEMA.required).not.toContain('draft');
    });

    test('requires name and exercises in draft', () => {
      const draftSchema = (AI_TURN_SCHEMA.properties as any).draft;
      expect(draftSchema.required).toContain('name');
      expect(draftSchema.required).toContain('exercises');
    });

    test('requires title and kind in exercise', () => {
      const draftSchema = (AI_TURN_SCHEMA.properties as any).draft;
      const exerciseSchema = draftSchema.properties.exercises.items;
      expect(exerciseSchema.required).toContain('title');
      expect(exerciseSchema.required).toContain('kind');
    });

    test('has enum for kind with strength, cardio, stretch', () => {
      const draftSchema = (AI_TURN_SCHEMA.properties as any).draft;
      const exerciseSchema = draftSchema.properties.exercises.items;
      expect(exerciseSchema.properties.kind.enum).toEqual(['strength', 'cardio', 'stretch']);
    });

    test('allows an optional string description on exercises', () => {
      const draftSchema = (AI_TURN_SCHEMA.properties as any).draft;
      const exerciseSchema = draftSchema.properties.exercises.items;
      expect(exerciseSchema.properties.description).toEqual({ type: 'string' });
      expect(exerciseSchema.required).not.toContain('description');
    });

    // #276 AC4.1: the draft exercise carries an ordered set list. `minItems`
    // cannot express "at least one" — it is on UNSUPPORTED_SCHEMA_KEYWORDS and
    // 400s the entire request before the model runs (PR #71) — so the schema
    // declares the shape and validateRoutineDraft enforces the count.
    describe('per-set exercise schema (AC4.1)', () => {
      const exerciseSchema = () =>
        ((AI_TURN_SCHEMA.properties as any).draft.properties.exercises.items) as any;

      test('declares sets as an array of set objects and requires it', () => {
        expect(exerciseSchema().properties.sets.type).toBe('array');
        expect(exerciseSchema().properties.sets.items.type).toBe('object');
        expect(exerciseSchema().required).toContain('sets');
      });

      test('declares exactly the five per-set properties, with type required', () => {
        const setSchema = exerciseSchema().properties.sets.items;

        expect(Object.keys(setSchema.properties).sort()).toEqual([
          'durationSeconds',
          'reps',
          'repsMax',
          'type',
          'weightLbs',
        ]);
        expect(setSchema.required).toEqual(['type']);
        expect(setSchema.additionalProperties).toBe(false);
      });

      test('constrains the set type to the plan vocabulary, not the session one', () => {
        const setSchema = exerciseSchema().properties.sets.items;

        expect(setSchema.properties.type).toEqual({
          type: 'string',
          enum: ['warmup', 'normal'],
        });
      });

      test('declares weightLbs as number with no bound keywords, reps as integer', () => {
        const setSchema = exerciseSchema().properties.sets.items;

        // `number`, not `integer`: the bound is a 0.5lb grid. And no `minimum`
        // or `multipleOf` — both are unsupported keywords.
        expect(setSchema.properties.weightLbs).toEqual({ type: 'number' });
        expect(setSchema.properties.reps).toEqual({ type: 'integer' });
        expect(setSchema.properties.repsMax).toEqual({ type: 'integer' });
        expect(setSchema.properties.durationSeconds).toEqual({ type: 'integer' });
      });

      test('carries no minItems anywhere, and stays inside the structured-output subset', () => {
        // Named separately from the whole-schema guard below because THIS is
        // the keyword a reader is most tempted to add for AC4.6.
        expect(JSON.stringify(AI_TURN_SCHEMA)).not.toContain('minItems');
        expectStructuredOutputSafe(AI_TURN_SCHEMA);
      });

      test('no longer declares the per-exercise aggregates the set list replaced', () => {
        // One turn shape, three declarations: the schema, the validators and
        // the persona must not offer two ways to say the same thing.
        const properties = Object.keys(exerciseSchema().properties);

        expect(properties).not.toContain('warmupSets');
        expect(properties).not.toContain('targetSets');
        expect(properties).not.toContain('targetReps');
        expect(properties).not.toContain('targetDurationSeconds');
        expect(properties).not.toContain('targetWeightLbs');
      });
    });

    test('does not require settingsProposal at root level', () => {
      expect(AI_TURN_SCHEMA.required).not.toContain('settingsProposal');
    });

    test('has additionalProperties false on settingsProposal object', () => {
      const proposalSchema = (AI_TURN_SCHEMA.properties as any).settingsProposal;
      expect(proposalSchema.additionalProperties).toBe(false);
    });

    test('declares goals, equipment, and personality as strings on settingsProposal', () => {
      const proposalSchema = (AI_TURN_SCHEMA.properties as any).settingsProposal;
      expect(proposalSchema.properties.goals.type).toBe('string');
      expect(proposalSchema.properties.equipment.type).toBe('string');
      expect(proposalSchema.properties.personality.type).toBe('string');
    });

    test('requires no settingsProposal field individually', () => {
      // "at least one of" is not expressible in the schema subset used here;
      // validateSettingsProposal is what enforces it.
      const proposalSchema = (AI_TURN_SCHEMA.properties as any).settingsProposal;
      expect(proposalSchema.required ?? []).toEqual([]);
    });

    test('coach-onboarding.AC2.2 Success: expectStructuredOutputSafe passes with three new properties', () => {
      // Verify that the widened schema with age and experience carries no
      // unsupported keywords that would cause the Anthropic structured-output
      // endpoint to reject the request with a 400.
      expectStructuredOutputSafe(AI_TURN_SCHEMA);
    });

    test('declares age and experience as strings on settingsProposal', () => {
      const proposalSchema = (AI_TURN_SCHEMA.properties as any).settingsProposal;
      expect(proposalSchema.properties.age?.type).toBe('string');
      expect(proposalSchema.properties.experience?.type).toBe('string');
    });

    test('issue-191: guards optional property count stays under 20 (structural grammar ceiling)', () => {
      // The Anthropic structured-output endpoint hard-400s around 24 optional properties
      // due to grammar complexity limits. This threshold of 20 gives early warning (~4 property headroom)
      // so that adding new fields breaks the test before hitting the runtime failure.
      //
      // Recursively count optional fields at all levels of the schema tree.
      // Traverses `properties` and `items` only; does not descend into `anyOf`,
      // `allOf`, `oneOf`, `$defs`, `definitions`, `not`, `contains`, `propertyNames`,
      // `additionalProperties`, `patternProperties`, or `prefixItems`. Extend if
      // AI_TURN_SCHEMA ever uses those keywords.
      type SchemaNode = {
        properties?: Record<string, SchemaNode>;
        items?: SchemaNode;
        required?: readonly string[];
      };

      function countOptional(node: SchemaNode): number {
        if (!node || typeof node !== 'object') return 0;
        let count = 0;
        const required = node.required ?? [];
        for (const [name, child] of Object.entries(node.properties ?? {})) {
          if (!required.includes(name)) count++;
          count += countOptional(child);
        }
        if (node.items) count += countOptional(node.items);
        return count;
      }

      const optionalCount = countOptional(AI_TURN_SCHEMA as SchemaNode);

      // Bump this deliberately when AI_TURN_SCHEMA legitimately grows — if this assertion moves,
      // also re-check the <20 ceiling below still gives comfortable headroom before Anthropic's
      // ~24-optional-property structured-output limit.
      // Bumped from 16 to 17 for targetWeightLbs (phase 2 of coach-prescribed-weights).
      // Back to 16 in #276 Phase 4: five per-exercise optionals
      // (warmupSets/targetSets/targetReps/targetDurationSeconds/targetWeightLbs)
      // left, four per-SET optionals (reps/repsMax/weightLbs/durationSeconds)
      // arrived, and `sets` itself is required.
      //
      // CAVEAT worth stating, because this number went DOWN while the schema
      // got structurally deeper: the count is a proxy for grammar complexity
      // and does not model nesting. Phase 4 introduced the schema's first
      // array-of-objects inside an array-of-objects. If a live call ever 400s
      // with a grammar-complexity error while this assertion is comfortably
      // green, the nesting — not the count — is the thing to look at.
      expect(optionalCount).toBe(16);
      expect(optionalCount).toBeLessThan(20);

      // Self-check: proves countOptional actually descends the tree, not just relabels a hardcoded
      // walk of AI_TURN_SCHEMA's current known paths (which would also happen to return 16 above —
      // see PR #199 review history). A hardcoded walk would get these wrong.
      expect(countOptional({ properties: { a: { properties: { b: {}, c: {} } } } })).toBe(3);
      expect(countOptional({ properties: { xs: { items: { properties: { y: {} } } } } })).toBe(2);
    });
  });
});
