/**
 * Validate JSON schemas against OpenAI's structured output keyword restrictions.
 *
 * OpenAI's Responses API rejects schemas containing unsupported keywords.
 * This validator catches those before sending a request (which would fail with 400).
 */

/**
 * Keywords that OpenAI's structured output does NOT support.
 * These are verified against the live endpoint behavior per the task.
 *
 * Supported keywords (will NOT be in this list):
 * - enum, anyOf, oneOf, pattern, format, multipleOf
 * - minimum, maximum, exclusiveMinimum, exclusiveMaximum
 * - minItems, maxItems
 * - contains, minContains, maxContains, propertyNames
 * - unevaluatedProperties, unevaluatedItems
 *
 * Notably includes composition keywords (allOf, not, if/then/else) that
 * the task description emphasizes.
 */
const UNSUPPORTED_FOR_OPENAI = [
  // Composition/conditional keywords (schema combinators)
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',

  // String bounds (minLength/maxLength are NOT supported)
  'minLength',
  'maxLength',

  // Object property counts (minProperties/maxProperties are NOT supported)
  'minProperties',
  'maxProperties',

  // Other unsupported keywords
  'patternProperties',
  'uniqueItems',
] as const;

/** Keywords whose value is a single nested schema. */
const SCHEMA_VALUED = ['items', 'additionalItems', 'additionalProperties', 'contains', 'propertyNames'];

/** Keywords whose value is a list of schemas. */
const SCHEMA_LIST_VALUED = ['anyOf', 'oneOf', 'prefixItems'];

/**
 * Keywords whose value is a map of name → schema.
 * The keys are field names, not keywords.
 */
const SCHEMA_MAP_VALUED = ['properties', '$defs', 'definitions'];

const isSchemaNode = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Find structural violations for OpenAI's strict: true mode.
 * Strict mode requires:
 * 1. Every object must have additionalProperties: false
 * 2. Every property in required must exist in properties
 *
 * @returns array of paths to structural violations
 */
export function findStructuralViolationsForOpenAI(schema: unknown): string[] {
  const violations: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (!isSchemaNode(node)) return;

    // Check if this looks like an object schema
    if (node.type === 'object' || node.properties !== undefined) {
      // Check: must have additionalProperties: false
      if (node.additionalProperties !== false) {
        violations.push(`${path}.additionalProperties must be false (or implicit false)`);
      }

      // Check: all required properties must exist in properties
      const required = node.required;
      const properties = node.properties;
      if (Array.isArray(required) && isSchemaNode(properties)) {
        for (const prop of required) {
          if (!(prop in properties)) {
            violations.push(`${path}.required contains "${prop}" but it's not in properties`);
          }
        }
      }
    }

    // Walk into nested schemas
    for (const [key, value] of Object.entries(node)) {
      const here = `${path}.${key}`;

      if (SCHEMA_VALUED.includes(key)) {
        walk(value, here);
      } else if (SCHEMA_LIST_VALUED.includes(key)) {
        if (Array.isArray(value)) {
          value.forEach((child, i) => walk(child, `${here}[${i}]`));
        }
      } else if (SCHEMA_MAP_VALUED.includes(key)) {
        if (isSchemaNode(value)) {
          for (const [name, child] of Object.entries(value)) {
            walk(child, `${here}.${name}`);
          }
        }
      }
    }
  };

  walk(schema, '$');
  return violations;
}

/**
 * Find all unsupported keywords in a schema for OpenAI structured output.
 *
 * @returns array of paths to unsupported keywords (e.g., ['$.properties.name.minLength'])
 *          Empty array means the schema is safe for OpenAI.
 */
export function findUnsupportedKeywordsForOpenAI(schema: unknown): string[] {
  const found: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (!isSchemaNode(node)) return;

    for (const [key, value] of Object.entries(node)) {
      const here = `${path}.${key}`;

      if ((UNSUPPORTED_FOR_OPENAI as readonly string[]).includes(key)) {
        found.push(here);
        // Don't continue walking inside unsupported keywords
        continue;
      }

      if (SCHEMA_VALUED.includes(key)) {
        walk(value, here);
      } else if (SCHEMA_LIST_VALUED.includes(key)) {
        if (Array.isArray(value)) {
          value.forEach((child, i) => walk(child, `${here}[${i}]`));
        }
      } else if (SCHEMA_MAP_VALUED.includes(key)) {
        if (isSchemaNode(value)) {
          for (const [name, child] of Object.entries(value)) {
            walk(child, `${here}.${name}`);
          }
        }
      }
    }
  };

  walk(schema, '$');
  return found;
}

/**
 * Assert that a schema is safe for OpenAI structured output.
 * Throws if unsupported keywords or structural violations are found.
 *
 * Used in tests to validate schemas before wiring them up.
 */
export function expectStructuredOutputSafeForOpenAI(schema: unknown): void {
  const unsupported = findUnsupportedKeywordsForOpenAI(schema);
  if (unsupported.length > 0) {
    throw new Error(
      `Schema contains unsupported keywords for OpenAI structured output:\n${unsupported.join('\n')}`
    );
  }

  const structural = findStructuralViolationsForOpenAI(schema);
  if (structural.length > 0) {
    throw new Error(
      `Schema violates OpenAI strict mode requirements:\n${structural.join('\n')}`
    );
  }
}
