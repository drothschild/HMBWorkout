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
            { title: 'Bench Press', kind: 'strength' },
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
          exercises: [{ title: 'Bench Press', kind: 'strength' }],
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
          exercises: [{ title: 'Bench Press', kind: 'strength' }],
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

    test('issue-191: pins empty string in goals throws from parseAiTurn, not silently dropped', () => {
      // { goals: '' } should throw from parseAiTurn because validateSettingsProposal
      // rejects empty/whitespace-only strings. This guards against the behavior
      // flipping to silently drop it as if goals were undefined.
      const json = JSON.stringify({
        reply: 'reply',
        settingsProposal: { goals: '' },
      });

      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
      expect(() => parseAiTurn(json)).toThrow('must be a non-empty string');
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

  describe('validateRoutineDraft', () => {
    test('accepts minimal valid draft', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
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
        exercises: [{ title: '', kind: 'strength' as const }],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects exercise title that slugifies to empty', () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: '!!!', kind: 'strength' as const }],
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

    test('rejects non-number targetSets', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetSets: 'three' as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-number targetReps', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetReps: 'ten' as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-number targetDurationSeconds', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Running',
            kind: 'cardio' as const,
            targetDurationSeconds: 'thirty' as any,
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
            restSeconds: 'sixty' as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-number warmupSets', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            warmupSets: 'one' as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-string routine notes', () => {
      const draft = {
        name: 'My Routine',
        notes: { a: 1 } as any,
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
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
            notes: { a: 1 } as any,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects negative targetSets', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetSets: -3,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects fractional targetReps', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetReps: 2.7,
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
            restSeconds: -60,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects zero targetSets', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetSets: 0,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects zero targetReps', () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetReps: 0,
          },
        ],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('accepts routine-level notes', () => {
      const draft = {
        name: 'My Routine',
        notes: 'My notes',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
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
      // Count optional properties: those in AI_TURN_SCHEMA.properties but NOT in required array.
      // Recursively count optional fields in nested objects (draft, exercise items, settingsProposal).
      function countOptionalProperties(schema: any, parentRequired: readonly string[] = []): number {
        if (!schema || typeof schema !== 'object') {
          return 0;
        }

        let count = 0;

        // Count optional properties at this level
        if (schema.properties && typeof schema.properties === 'object') {
          for (const propName of Object.keys(schema.properties)) {
            // A property is optional if it's not in the required array
            if (!parentRequired.includes(propName)) {
              count++;
            }
          }
        }

        // Recurse into nested objects
        if (schema.properties) {
          // Check draft properties and nested exercise items
          if (schema.properties.draft) {
            const draftSchema = schema.properties.draft;
            const draftRequired = draftSchema.required ?? [];
            // Count optional in draft itself
            if (draftSchema.properties) {
              for (const propName of Object.keys(draftSchema.properties)) {
                if (!draftRequired.includes(propName)) {
                  count++;
                }
              }
            }
            // Count optional in exercise items
            if (draftSchema.properties?.exercises?.items?.properties) {
              const exerciseRequired = draftSchema.properties.exercises.items.required ?? [];
              for (const propName of Object.keys(draftSchema.properties.exercises.items.properties)) {
                if (!exerciseRequired.includes(propName)) {
                  count++;
                }
              }
            }
          }

          // Check settingsProposal properties
          if (schema.properties.settingsProposal) {
            const proposalSchema = schema.properties.settingsProposal;
            const proposalRequired = proposalSchema.required ?? [];
            if (proposalSchema.properties) {
              for (const propName of Object.keys(proposalSchema.properties)) {
                if (!proposalRequired.includes(propName)) {
                  count++;
                }
              }
            }
          }
        }

        return count;
      }

      const optionalCount = countOptionalProperties(AI_TURN_SCHEMA, AI_TURN_SCHEMA.required ?? []);

      expect(optionalCount).toBeLessThan(20);
    });
  });
});
