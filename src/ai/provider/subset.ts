/**
 * Validate JSON schemas against OpenAI's structured output keyword restrictions.
 *
 * OpenAI's Responses API rejects schemas containing unsupported keywords.
 * This validator catches those before sending a request (which would fail with 400).
 */

/**
 * Keywords that OpenAI's structured output does NOT support.
 *
 * Documented as unsupported in OpenAI's official structured output guide.
 * Keywords with no explicit documentation are conservatively treated as unsupported
 * until proven against the live endpoint. This guard catches them before sending a
 * request (which would fail with 400 and never run the model).
 *
 * Notably includes composition keywords (allOf, not, if/then/else, oneOf) and
 * several keywords that OpenAI's guide explicitly lists as unsupported.
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
  'oneOf',

  // String bounds (explicitly unsupported)
  'minLength',
  'maxLength',
  'pattern',

  // Numeric bounds (explicitly unsupported)
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',

  // Array/object counts (explicitly unsupported)
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',

  // Array/object introspection keywords (explicitly unsupported)
  'contains',
  'minContains',
  'maxContains',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'prefixItems',

  // Other unsupported keywords
  'patternProperties',
  'uniqueItems',
] as const;

/** Keywords whose value is a single nested schema. */
const SCHEMA_VALUED = ['items', 'additionalItems', 'additionalProperties', 'contains', 'propertyNames'];

/** Keywords whose value is a list of schemas. */
const SCHEMA_LIST_VALUED = ['anyOf', 'prefixItems'];

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
 * 2. Every property in properties must be in required (all properties are required)
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

      // Check: all properties must be in required
      const required = node.required;
      const properties = node.properties;
      if (isSchemaNode(properties)) {
        const requiredSet = new Set(Array.isArray(required) ? required : []);
        for (const prop of Object.keys(properties)) {
          if (!requiredSet.has(prop)) {
            violations.push(`${path}.properties.${prop} is not in required`);
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
 * Transform a schema to be OpenAI-compatible.
 *
 * OpenAI's strict mode requires all properties to be in the required array,
 * and optional fields to be expressed as nullable types (e.g., `type: ["string", "null"]`).
 *
 * This transform does NOT mutate the input schema — it returns a new copy.
 */
export function transformSchemaForOpenAI(schema: unknown): unknown {
  const deepClone = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(deepClone);
    }
    if (obj instanceof Date || obj instanceof RegExp) {
      return obj;
    }
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      cloned[key] = deepClone(value);
    }
    return cloned;
  };

  const hasTypeField = (schema: unknown): boolean => {
    return isSchemaNode(schema) && 'type' in schema && schema.type !== null;
  };

  const transform = (node: unknown): unknown => {
    if (!isSchemaNode(node)) {
      return node;
    }

    const transformed = { ...node };

    // If this is an object schema, ensure it has properties and additionalProperties: false
    if (transformed.type === 'object' || transformed.properties !== undefined) {
      // Handle edge case: type: 'object' with no properties
      if (!isSchemaNode(transformed.properties)) {
        transformed.properties = {};
      }

      const properties = transformed.properties as Record<string, unknown>;
      const required = Array.isArray(transformed.required) ? transformed.required : [];
      const requiredSet = new Set(required);

      // OpenAI strict mode requires additionalProperties: false
      transformed.additionalProperties = false;

      // OpenAI strict mode requires EVERY property to appear in `required` —
      // there is no such thing as an exempt property. An earlier version left
      // anyOf-only and const-only properties out on the reasoning that they
      // "cannot express absence", which inverted the rule: the transform then
      // emitted schemas that its own findStructuralViolationsForOpenAI
      // rejected, and buildOpenAiBody's self-check would throw on them.
      //
      // The answer is to give them a way to express absence rather than to
      // exempt them. A property with a plain `type` is widened to
      // `type: [..., 'null']`; one defined by `anyOf`, `enum`, or `const` gets
      // a `{ type: 'null' }` branch or null in the enum instead. Either way it
      // lands in `required`.
      //
      // Not reachable from today's schemas (neither AI_TURN_SCHEMA nor
      // ALTERNATES_SCHEMA uses anyOf or const), but it is about to be:
      // PR #111 banned `oneOf` and OpenAI's documented replacement is `anyOf`.
      const optionalProps = Object.keys(properties).filter((k) => !requiredSet.has(k));

      // Every property is required under strict mode.
      transformed.required = Object.keys(properties);

      // Transform properties
      const newProperties: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(properties)) {
        if (optionalProps.includes(propName) && isSchemaNode(propSchema)) {
          const widened = { ...propSchema };

          if (hasTypeField(widened)) {
            // Plain type: widen to a union including null.
            const currentType = widened.type;
            if (typeof currentType === 'string') {
              widened.type = [currentType, 'null'];
            } else if (Array.isArray(currentType) && !currentType.includes('null')) {
              widened.type = [...currentType, 'null'];
            }
            // An enum constrains the value set, so null must join it too or a
            // compliant model still cannot emit the value the type now permits.
            if (Array.isArray(widened.enum) && !widened.enum.includes(null)) {
              widened.enum = [...widened.enum, null];
            }
          } else if (Array.isArray(widened.enum)) {
            // Enum-only (no type field): add null to the enum to allow absence.
            if (!widened.enum.includes(null)) {
              widened.enum = [...widened.enum, null];
            }
          } else if (Array.isArray(widened.anyOf)) {
            // anyOf-defined: add a null branch rather than a `type` key, which
            // would fight the anyOf.
            const hasNull = widened.anyOf.some(
              (b) => isSchemaNode(b) && (b as Record<string, unknown>).type === 'null'
            );
            if (!hasNull) widened.anyOf = [...widened.anyOf, { type: 'null' }];
          } else if ('const' in widened) {
            // const-defined: the only way to admit absence is to offer the
            // const or null as alternatives. Use enum (supported) instead of const
            // (unsupported) to avoid carrying an unsupported keyword to the wire.
            const literal = widened.const;
            delete widened.const;
            widened.enum = [literal, null];
          }

          newProperties[propName] = transform(widened);
        } else {
          // Originally required — transform without widening.
          newProperties[propName] = transform(propSchema);
        }
      }
      transformed.properties = newProperties;
    }

    // Recursively transform nested schemas
    for (const [key, value] of Object.entries(transformed)) {
      if (SCHEMA_VALUED.includes(key)) {
        transformed[key] = transform(value);
      } else if (SCHEMA_LIST_VALUED.includes(key)) {
        if (Array.isArray(value)) {
          transformed[key] = value.map(child => transform(child));
        }
      } else if (SCHEMA_MAP_VALUED.includes(key)) {
        if (isSchemaNode(value)) {
          const transformed_map: Record<string, unknown> = {};
          for (const [name, child] of Object.entries(value)) {
            transformed_map[name] = transform(child);
          }
          transformed[key] = transformed_map;
        }
      }
    }

    return transformed;
  };

  // Deep clone first to ensure input is never mutated
  const cloned = deepClone(schema);
  return transform(cloned);
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
