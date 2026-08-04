import {
  findUnsupportedKeywordsForOpenAI,
  expectStructuredOutputSafeForOpenAI,
} from './subset';

describe('OpenAI structured output schema validation', () => {
  describe('findUnsupportedKeywordsForOpenAI', () => {
    it('accepts schema with supported keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          data: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['reply'],
        additionalProperties: false,
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toEqual([]);
    });

    it('rejects allOf composition keyword', () => {
      const schema = {
        allOf: [{ type: 'object' }, { properties: { x: { type: 'string' } } }],
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.allOf');
    });

    it('rejects not composition keyword', () => {
      const schema = {
        type: 'object',
        properties: {
          x: { not: { type: 'null' } },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported.some(k => k.includes('not'))).toBe(true);
    });

    it('rejects if/then/else conditional keywords', () => {
      const schema = {
        type: 'object',
        if: { properties: { x: { type: 'string' } } },
        then: { properties: { y: { type: 'number' } } },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.if');
      expect(unsupported).toContain('$.then');
    });

    it('rejects minLength/maxLength on strings', () => {
      const schema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
          },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.properties.name.minLength');
      expect(unsupported).toContain('$.properties.name.maxLength');
    });

    it('rejects minProperties/maxProperties on objects', () => {
      const schema = {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            minProperties: 1,
            maxProperties: 5,
          },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.properties.data.minProperties');
      expect(unsupported).toContain('$.properties.data.maxProperties');
    });

    it('rejects dependentSchemas and dependentRequired', () => {
      const schema = {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
        dependentSchemas: {
          a: { properties: { b: { type: 'string' } } },
        },
        dependentRequired: {
          a: ['b'],
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported.some(k => k.includes('dependent'))).toBe(true);
    });

    it('accepts enum keyword', () => {
      const schema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive'],
          },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported.filter(k => k.includes('enum'))).toEqual([]);
    });

    it('accepts anyOf keyword', () => {
      const schema = {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toEqual([]);
    });

    it('accepts pattern, format, and numeric bounds keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            pattern: '^[^@]+@[^@]+$',
            format: 'email',
          },
          price: {
            type: 'number',
            minimum: 0,
            maximum: 10000,
            multipleOf: 0.01,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 5,
          },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toEqual([]);
    });

    it('reports nested unsupported keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: {
              deep: {
                type: 'string',
                minLength: 5,
              },
            },
          },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.properties.nested.properties.deep.minLength');
    });

    it('rejects patternProperties', () => {
      const schema = {
        type: 'object',
        patternProperties: {
          '^S_': { type: 'string' },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.patternProperties');
    });
  });

  describe('expectStructuredOutputSafeForOpenAI', () => {
    it('passes for valid schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['reply'],
        additionalProperties: false,
      };

      expect(() => expectStructuredOutputSafeForOpenAI(schema)).not.toThrow();
    });

    it('throws for schemas with unsupported keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
          },
        },
      };

      expect(() => expectStructuredOutputSafeForOpenAI(schema)).toThrow();
    });
  });

  describe('all existing schemas are safe', () => {
    it('AI_TURN_SCHEMA is safe for OpenAI', () => {
      const AI_TURN_SCHEMA = {
        type: 'object',
        properties: {
          reply: { type: 'string', description: 'Conversational reply' },
          draft: {
            type: 'object',
            description: 'New routine or revision',
            properties: {
              name: { type: 'string' },
              notes: { type: 'string' },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    kind: { type: 'string', enum: ['strength', 'cardio', 'stretch'] },
                    warmupSets: { type: 'integer' },
                    targetSets: { type: 'integer' },
                    targetReps: { type: 'integer' },
                    targetDurationSeconds: { type: 'integer' },
                    restSeconds: { type: 'integer' },
                  },
                  required: ['title', 'kind'],
                  additionalProperties: false,
                },
              },
            },
            required: ['name', 'exercises'],
            additionalProperties: false,
          },
          settingsProposal: {
            type: 'object',
            properties: {
              goals: { type: 'string' },
              equipment: { type: 'string' },
              personality: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['reply'],
        additionalProperties: false,
      };

      expect(() => expectStructuredOutputSafeForOpenAI(AI_TURN_SCHEMA)).not.toThrow();
    });
  });
});
