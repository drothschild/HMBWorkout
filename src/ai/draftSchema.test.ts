import {
  parseAiTurn,
  validateRoutineDraft,
  validateSettingsProposal,
  slugifyTitle,
  DraftValidationError,
  AI_TURN_SCHEMA,
  SETTINGS_FIELD_MAX_LENGTH,
} from './draftSchema';

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

    test('throws DraftValidationError when settingsProposal is invalid', () => {
      const json = JSON.stringify({
        reply: 'reply',
        settingsProposal: {}, // neither goals nor equipment
      });

      expect(() => parseAiTurn(json)).toThrow(DraftValidationError);
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

    test('rejects a proposal carrying no fields', () => {
      expect(() => validateSettingsProposal({})).toThrow(
        'a settings proposal must include at least one of goals, equipment, or personality'
      );
    });

    test('rejects a proposal whose only fields are undefined', () => {
      expect(() =>
        validateSettingsProposal({ goals: undefined, equipment: undefined, personality: undefined })
      ).toThrow(DraftValidationError);
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
      expect((result.exercises[0] as any).description).toBe(
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
  });
});
