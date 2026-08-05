import {
  findUnsupportedKeywordsForOpenAI,
  expectStructuredOutputSafeForOpenAI,
  transformSchemaForOpenAI,
  findStructuralViolationsForOpenAI,
} from './subset';
import { AI_TURN_SCHEMA } from '../draftSchema';
import { ALTERNATES_SCHEMA } from '../alternatesSchema';

/**
 * Captured at module load, before any test body runs — the only point at which
 * these schemas are guaranteed untouched by a transform call in this file.
 */
const PRISTINE_AI_TURN = JSON.stringify(AI_TURN_SCHEMA);
const PRISTINE_ALTERNATES = JSON.stringify(ALTERNATES_SCHEMA);

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

    it('rejects dependentSchemas', () => {
      const schema = {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
        dependentSchemas: {
          a: { properties: { b: { type: 'string' } } },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.dependentSchemas');
    });

    it('rejects dependentRequired', () => {
      const schema = {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
        dependentRequired: {
          a: ['b'],
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.dependentRequired');
    });

    it('rejects else keyword', () => {
      const schema = {
        type: 'object',
        if: { properties: { x: { type: 'string' } } },
        then: { properties: { y: { type: 'number' } } },
        else: { properties: { z: { type: 'boolean' } } },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.else');
    });

    it('rejects uniqueItems keyword', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.properties.tags.uniqueItems');
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
    it('passes for valid schemas with all properties required', () => {
      const schema = {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          count: { type: ['number', 'null'] },
        },
        required: ['reply', 'count'],
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

  describe('all existing schemas are safe after transformation', () => {
    it('AI_TURN_SCHEMA becomes safe for OpenAI after transform', () => {
      const transformed = transformSchemaForOpenAI(AI_TURN_SCHEMA);
      expect(() => expectStructuredOutputSafeForOpenAI(transformed)).not.toThrow();
    });

    it('ALTERNATES_SCHEMA becomes safe for OpenAI after transform', () => {
      const transformed = transformSchemaForOpenAI(ALTERNATES_SCHEMA);
      expect(() => expectStructuredOutputSafeForOpenAI(transformed)).not.toThrow();
    });

    it('puts anyOf- and const-only properties in required, with a null branch', () => {
      // OpenAI strict mode has no exempt properties: every key in `properties`
      // must appear in `required`. An earlier version left anyOf/const props
      // out because they "cannot express absence" — which made the transform
      // emit schemas its OWN findStructuralViolationsForOpenAI rejected, and
      // buildOpenAiBody's self-check would have thrown on them. Give them a
      // way to express absence instead of exempting them.
      const schema = {
        type: 'object',
        properties: {
          always: { type: 'string' },
          viaAnyOf: { anyOf: [{ type: 'string' }] },
          viaConst: { const: 'x' },
          viaEnum: { type: 'string', enum: ['a'] },
        },
        required: ['always'],
        additionalProperties: false,
      };

      const t = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const props = t.properties as Record<string, Record<string, unknown>>;

      expect(t.required).toEqual(['always', 'viaAnyOf', 'viaConst', 'viaEnum']);
      expect(props.viaAnyOf.anyOf).toContainEqual({ type: 'null' });
      expect(props.viaConst.anyOf).toContainEqual({ type: 'null' });
      // enum must admit null too, or a compliant model cannot emit the value
      // the widened type now permits.
      expect(props.viaEnum.enum).toContain(null);

      // The transform's own output must satisfy the project's own guard.
      expect(findStructuralViolationsForOpenAI(t)).toEqual([]);
    });

    it('transform does not mutate input schemas', () => {
      // Compare against PRISTINE_AI_TURN, captured at module load. Snapshotting
      // inside this test is not enough: earlier tests in this file already run
      // the transform, so a mutating implementation corrupts the schema BEFORE
      // the snapshot and the snapshot faithfully records the corruption. That
      // is why the round-2 version of this guard survived a full-file mutation
      // run and only died under `-t`.
      transformSchemaForOpenAI(AI_TURN_SCHEMA);
      expect(JSON.stringify(AI_TURN_SCHEMA)).toBe(PRISTINE_AI_TURN);

      transformSchemaForOpenAI(ALTERNATES_SCHEMA);
      expect(JSON.stringify(ALTERNATES_SCHEMA)).toBe(PRISTINE_ALTERNATES);
    });
  });

  describe('widening edge cases', () => {
    it('optional enum adds null to enum list when widening', () => {
      const schema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive'],
          },
        },
        required: [],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const statusProp = (transformed.properties as Record<string, unknown>)
        .status as Record<string, unknown>;

      // When an optional enum is widened to nullable, null must be added to the enum
      expect(statusProp.type).toEqual(['string', 'null']);
      expect(statusProp.enum).toContain('active');
      expect(statusProp.enum).toContain('inactive');
      expect(statusProp.enum).toContain(null);
    });

    it('property defined only by anyOf IS required, with a null branch added', () => {
      const schema = {
        type: 'object',
        properties: {
          flexible: {
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
        required: [],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const props = transformed.properties as Record<string, Record<string, unknown>>;

      // Strict mode has no exempt properties. An earlier version left anyOf-only
      // properties out of `required` on the reasoning that they "cannot express
      // absence" — which made this transform emit schemas its own
      // findStructuralViolationsForOpenAI rejected. Absence is expressed by
      // adding a null branch, not by exempting the property.
      expect(transformed.required as string[]).toContain('flexible');
      expect(props.flexible.anyOf).toContainEqual({ type: 'null' });
      expect(findStructuralViolationsForOpenAI(transformed)).toEqual([]);
    });

    it('property defined only by const IS required, rewritten as anyOf with null', () => {
      const schema = {
        type: 'object',
        properties: {
          fixed: {
            const: 'CONSTANT_VALUE',
          },
        },
        required: [],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const props = transformed.properties as Record<string, Record<string, unknown>>;

      // A bare `const` admits exactly one value, so the only way to allow
      // absence is to offer const-or-null as alternatives.
      expect(transformed.required as string[]).toContain('fixed');
      expect(props.fixed.anyOf).toEqual([{ const: 'CONSTANT_VALUE' }, { type: 'null' }]);
      expect(findStructuralViolationsForOpenAI(transformed)).toEqual([]);
    });

    it('transform is idempotent', () => {
      const schema = {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          optional: { type: 'number' },
        },
        required: ['reply'],
        additionalProperties: false,
      };

      const transformed1 = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const transformed2 = transformSchemaForOpenAI(transformed1);

      expect(JSON.stringify(transformed2)).toBe(JSON.stringify(transformed1));
    });
  });
});
