import { parseAiTurn, validateRoutineDraft, slugifyTitle, DraftValidationError, AI_TURN_SCHEMA } from './draftSchema';

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
        routineId: 'routine-1',
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

    test('rejects empty routineId', () => {
      const draft = {
        routineId: '',
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
      };

      expect(() => validateRoutineDraft(draft)).toThrow(DraftValidationError);
    });

    test('rejects non-string routineId', () => {
      const draft = {
        routineId: 12345 as any,
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
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

    test('accepts valid routineId', () => {
      const draft = {
        routineId: 'routine-123',
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
      };

      const result = validateRoutineDraft(draft);
      expect(result.routineId).toBe('routine-123');
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
  });
});
