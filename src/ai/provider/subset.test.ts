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

    it('rejects pattern, format, and numeric bounds keywords that OpenAI does not support', () => {
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
      // These are documented as supported by OpenAI for non-fine-tuned models,
      // but banned here as a house rule (bounds belong in validators)
      expect(unsupported).toContain('$.properties.email.pattern');
      expect(unsupported).toContain('$.properties.price.minimum');
      expect(unsupported).toContain('$.properties.price.maximum');
      expect(unsupported).toContain('$.properties.price.multipleOf');
      expect(unsupported).toContain('$.properties.tags.minItems');
      expect(unsupported).toContain('$.properties.tags.maxItems');
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

    it('puts anyOf-, const-, and enum-only properties in required, with a null branch', () => {
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
      // const is unsupported, so it's rewritten as enum
      expect(props.viaConst.enum).toContain('x');
      expect(props.viaConst.enum).toContain(null);
      expect(props.viaConst.const).toBeUndefined();
      // enum must admit null too, or a compliant model cannot emit the value
      // the widened type now permits.
      expect(props.viaEnum.enum).toContain(null);

      // The transform's own output must satisfy the project's own guard.
      expect(findStructuralViolationsForOpenAI(t)).toEqual([]);
    });

    it('ALTERNATES_SCHEMA has no optional fields, so transform leaves it unchanged', () => {
      // Every field in ALTERNATES_SCHEMA is required, so transformSchemaForOpenAI
      // should not widen any types to nullable. Assert the transformed output
      // deep-equals the input to guard against future changes that might add
      // optional fields without updating the transform logic.
      const transformed = transformSchemaForOpenAI(ALTERNATES_SCHEMA);
      expect(transformed).toEqual(ALTERNATES_SCHEMA);
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

    it('pins the exact shape of AI_TURN_SCHEMA against a copy checked into git', () => {
      // PRISTINE_AI_TURN (above) is `JSON.stringify(AI_TURN_SCHEMA)` captured at
      // module load — i.e. re-derived from the very module under test. It can
      // catch a transform mutating the schema object in place, but it CANNOT
      // catch drift: a field added to (or removed from, or renamed in)
      // `AI_TURN_SCHEMA` itself is captured into PRISTINE_AI_TURN along with the
      // change, so the two are always equal by construction and this class of
      // regression sails through green (PR #117 review).
      //
      // toMatchInlineSnapshot writes its expectation into THIS file, checked
      // into git independent of draftSchema.ts, so a schema edit that isn't
      // deliberately re-approved here (`jest -u`) shows as a diff in review and
      // fails CI. This is a second, independent detection mechanism, additive
      // to the module-load capture above rather than a replacement for it.
      expect(AI_TURN_SCHEMA).toMatchInlineSnapshot(`
{
  "additionalProperties": false,
  "properties": {
    "draft": {
      "additionalProperties": false,
      "description": "Include only when proposing a new routine or a revision of an existing one",
      "properties": {
        "exercises": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "description": {
                "type": "string",
              },
              "kind": {
                "enum": [
                  "strength",
                  "cardio",
                  "stretch",
                ],
                "type": "string",
              },
              "notes": {
                "type": "string",
              },
              "restSeconds": {
                "type": "integer",
              },
              "supersetGroup": {
                "type": "string",
              },
              "targetDurationSeconds": {
                "type": "integer",
              },
              "targetReps": {
                "type": "integer",
              },
              "targetSets": {
                "type": "integer",
              },
              "targetWeightLbs": {
                "type": "number",
              },
              "title": {
                "type": "string",
              },
              "warmupSets": {
                "type": "integer",
              },
            },
            "required": [
              "title",
              "kind",
            ],
            "type": "object",
          },
          "type": "array",
        },
        "name": {
          "type": "string",
        },
        "notes": {
          "type": "string",
        },
      },
      "required": [
        "name",
        "exercises",
      ],
      "type": "object",
    },
    "reply": {
      "description": "Conversational reply shown to the user",
      "type": "string",
    },
    "settingsProposal": {
      "additionalProperties": false,
      "description": "Include only when the user asked to change their training goals, available equipment, coaching style, or profile information. At least one field is required",
      "properties": {
        "age": {
          "type": "string",
        },
        "equipment": {
          "type": "string",
        },
        "experience": {
          "type": "string",
        },
        "goals": {
          "type": "string",
        },
        "personality": {
          "type": "string",
        },
      },
      "type": "object",
    },
  },
  "required": [
    "reply",
  ],
  "type": "object",
}
`);
    });

    it('pins the exact shape of ALTERNATES_SCHEMA against a copy checked into git', () => {
      // Same rationale as the AI_TURN_SCHEMA pin above.
      expect(ALTERNATES_SCHEMA).toMatchInlineSnapshot(`
{
  "additionalProperties": false,
  "properties": {
    "alternates": {
      "description": "Substitute exercises, best first",
      "items": {
        "additionalProperties": false,
        "properties": {
          "description": {
            "description": "How to perform it, and why it substitutes for the original",
            "type": "string",
          },
          "title": {
            "description": "The exercise name on its own, with no set or rep counts",
            "type": "string",
          },
        },
        "required": [
          "title",
          "description",
        ],
        "type": "object",
      },
      "type": "array",
    },
  },
  "required": [
    "alternates",
  ],
  "type": "object",
}
`);
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

    it('property defined only by const IS required, rewritten as enum with null', () => {
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

      // A bare `const` is unsupported, so the transform uses enum instead.
      // The only way to allow absence is to offer the literal or null as alternatives.
      expect(transformed.required as string[]).toContain('fixed');
      expect(props.fixed).toEqual({ enum: ['CONSTANT_VALUE', null] });
      expect(props.fixed.const).toBeUndefined();
      expect(findStructuralViolationsForOpenAI(transformed)).toEqual([]);
    });

    it('an ALREADY-REQUIRED const is rewritten as enum too, with no null branch', () => {
      // The sibling test above covers the optional path. This one exists because
      // the two rewrites are separate branches: PR #117's round-2 review found the
      // required path emitted a bare `const` straight to the wire, and every
      // existing const fixture omitted the property from `required`, so nothing
      // exercised it. Deleting the required-path branch must fail this test alone.
      const schema = {
        type: 'object',
        properties: {
          fixed: {
            const: 'CONSTANT_VALUE',
          },
        },
        required: ['fixed'],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const props = transformed.properties as Record<string, Record<string, unknown>>;

      // No null branch: the property is required, so absence is not expressible
      // and must not be offered. `const` itself is undocumented for OpenAI
      // structured output, which is why the literal moves into an enum at all.
      expect(props.fixed).toEqual({ enum: ['CONSTANT_VALUE'] });
      expect(props.fixed.const).toBeUndefined();
      expect(transformed.required as string[]).toContain('fixed');
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

    it('adds missing additionalProperties: false', () => {
      const schema = {
        type: 'object',
        properties: {
          reply: { type: 'string' },
        },
        required: ['reply'],
        // Note: no additionalProperties field
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;

      // The transform must add additionalProperties: false, not leave it absent
      expect(transformed.additionalProperties).toBe(false);
      expect(findStructuralViolationsForOpenAI(transformed)).toEqual([]);
    });

    it('handles optional enum-only properties without type field', () => {
      const schema = {
        type: 'object',
        properties: {
          status: {
            enum: ['active', 'inactive'],
          },
        },
        required: [],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const statusProp = (transformed.properties as Record<string, unknown>)
        .status as Record<string, unknown>;

      // When an optional enum-only property is widened to nullable,
      // null must be added to the enum
      expect(transformed.required as string[]).toContain('status');
      expect(statusProp.enum).toContain('active');
      expect(statusProp.enum).toContain('inactive');
      expect(statusProp.enum).toContain(null);
      expect(findStructuralViolationsForOpenAI(transformed)).toEqual([]);
    });

    it('throws on type:object with no properties field', () => {
      const schema = {
        type: 'object',
        // No properties field at all
      };

      // A free-form object cannot be expressed in strict mode, so this is a
      // build-time error, not silently emitted as an unsatisfiable schema.
      expect(() => transformSchemaForOpenAI(schema)).toThrow(
        /Cannot transform schema.*type "object" requires a properties object/
      );
    });

    it('widening is applied only to optional properties, not required', () => {
      const schema = {
        type: 'object',
        properties: {
          required_string: { type: 'string' },
          optional_string: { type: 'string' },
        },
        required: ['required_string'],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;
      const props = transformed.properties as Record<string, Record<string, unknown>>;

      // Required property should NOT be widened to include null
      expect(props.required_string.type).toBe('string');
      expect(props.required_string.type).not.toEqual(['string', 'null']);

      // Optional property SHOULD be widened to include null
      expect(props.optional_string.type).toEqual(['string', 'null']);
    });

    it('required array includes all properties in strict mode', () => {
      const schema = {
        type: 'object',
        properties: {
          always_required: { type: 'string' },
          initially_optional: { type: 'number' },
        },
        required: ['always_required'],
        additionalProperties: false,
      };

      const transformed = transformSchemaForOpenAI(schema) as Record<string, unknown>;

      // Strict mode requires EVERY property, so optional properties must be
      // added to required (along with null widening to express absence)
      expect(transformed.required as string[]).toContain('always_required');
      expect(transformed.required as string[]).toContain('initially_optional');
    });
  });

  describe('unsupported keywords for OpenAI', () => {
    it('rejects contains keyword', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
        contains: { type: 'string' },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.contains');
    });

    it('rejects minContains/maxContains keywords', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
        minContains: 1,
        maxContains: 5,
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.minContains');
      expect(unsupported).toContain('$.maxContains');
    });

    it('rejects propertyNames keyword', () => {
      const schema = {
        type: 'object',
        propertyNames: { type: 'string', pattern: '^[A-Z]' },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.propertyNames');
    });

    it('rejects unevaluatedProperties keyword', () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        unevaluatedProperties: false,
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.unevaluatedProperties');
    });

    it('rejects unevaluatedItems keyword', () => {
      const schema = {
        type: 'array',
        prefixItems: [{ type: 'string' }],
        unevaluatedItems: { type: 'number' },
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.unevaluatedItems');
    });

    it('rejects prefixItems keyword', () => {
      const schema = {
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.prefixItems');
    });

    it('rejects oneOf composition keyword', () => {
      const schema = {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.oneOf');
    });

    it('rejects pattern keyword', () => {
      const schema = {
        type: 'string',
        pattern: '^[A-Z]',
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.pattern');
    });

    it('rejects numeric bound keywords', () => {
      const schema = {
        type: 'number',
        minimum: 0,
        maximum: 100,
        exclusiveMinimum: -1,
        exclusiveMaximum: 101,
        multipleOf: 5,
      };

      const unsupported = findUnsupportedKeywordsForOpenAI(schema);
      expect(unsupported).toContain('$.minimum');
      expect(unsupported).toContain('$.maximum');
      expect(unsupported).toContain('$.exclusiveMinimum');
      expect(unsupported).toContain('$.exclusiveMaximum');
      expect(unsupported).toContain('$.multipleOf');
    });
  });

  describe('structural violations detection', () => {
    it('detects missing additionalProperties: false', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const violations = findStructuralViolationsForOpenAI(schema);
      expect(violations).toContain('$.additionalProperties must be false (or implicit false)');
    });

    it('detects required array missing optional properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      };

      const violations = findStructuralViolationsForOpenAI(schema);
      expect(violations).toContain('$.properties.description is not in required');
    });

    it('detects both missing additionalProperties AND missing required entries', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      };

      const violations = findStructuralViolationsForOpenAI(schema);
      expect(violations.length).toBeGreaterThan(1);
      expect(violations).toContain('$.additionalProperties must be false (or implicit false)');
      expect(violations.some(v => v.includes('description is not in required'))).toBe(true);
    });
  });
});
