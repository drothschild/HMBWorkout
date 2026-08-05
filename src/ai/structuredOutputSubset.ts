/**
 * The JSON-schema subset the Anthropic structured-output endpoint accepts.
 *
 * `output_config.format.json_schema` compiles the schema it is handed and
 * rejects the **entire request** with a 400 when it carries a keyword outside
 * that subset — the model never runs, so the caller sees a transport failure
 * rather than a bad answer. The official Anthropic SDKs strip these keywords
 * before sending and re-check them client-side; this app calls `/v1/messages`
 * over a hand-rolled `fetch` on purpose (see AGENTS.md, "No SDK, on purpose"),
 * so nothing strips them for us.
 *
 * That is not a hypothetical: `minItems`/`maxItems` on `ALTERNATES_SCHEMA` made
 * the Replace button fail on every tap until PR #71.
 *
 * This module is imported by both tests and production code (requestBuilder.ts).
 */

/**
 * Keywords the endpoint rejects: numeric bounds, string bounds, and array and
 * object counts.
 *
 * Deliberately a little wider than the documented list. `pattern`, `uniqueItems`,
 * `minProperties` and `maxProperties` are not named as supported *or* rejected,
 * so the guard treats them as rejected: a schema that needs one should prove it
 * works against the live endpoint and then be removed from this list, rather
 * than shipping on the assumption that silence means support.
 *
 * Bounds belong in the validators regardless — that is where the SDKs put the
 * keywords they strip, and the validators run on every payload anyway.
 */
export const UNSUPPORTED_SCHEMA_KEYWORDS = [
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minProperties',
  'maxProperties',
] as const;

/** Keywords whose value is a single nested schema. */
const SCHEMA_VALUED = ['items', 'not', 'contains', 'propertyNames', 'additionalProperties'];

/** Keywords whose value is a list of schemas. */
const SCHEMA_LIST_VALUED = ['anyOf', 'allOf', 'oneOf', 'prefixItems'];

/**
 * Keywords whose value is a map of *name* to schema. The keys here are field
 * names chosen by the schema author, not keywords — a property legitimately
 * named `pattern` or `maximum` is a field the model returns, not a constraint
 * the endpoint will choke on. Walking these blind is how a guard starts
 * rejecting valid schemas.
 */
const SCHEMA_MAP_VALUED = ['properties', 'patternProperties', '$defs', 'definitions'];

const isSchemaNode = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @returns the path of every unsupported keyword in `schema`, in document
 * order — e.g. `$.properties.alternates.minItems`. Empty means the schema is
 * safe to put on the wire.
 */
export function findUnsupportedKeywords(schema: unknown): string[] {
  const found: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (!isSchemaNode(node)) return;

    for (const [key, value] of Object.entries(node)) {
      const here = `${path}.${key}`;

      if ((UNSUPPORTED_SCHEMA_KEYWORDS as readonly string[]).includes(key)) {
        found.push(here);
        continue;
      }

      if (SCHEMA_VALUED.includes(key)) {
        walk(value, here);
      } else if (SCHEMA_LIST_VALUED.includes(key)) {
        if (Array.isArray(value)) value.forEach((child, i) => walk(child, `${here}[${i}]`));
      } else if (SCHEMA_MAP_VALUED.includes(key)) {
        if (isSchemaNode(value)) {
          for (const [name, child] of Object.entries(value)) walk(child, `${here}.${name}`);
        }
      }
    }
  };

  walk(schema, '$');

  return found;
}

/** Jest matcher-style assertion, so both schema suites read the same. */
export function expectStructuredOutputSafe(schema: unknown): void {
  expect(findUnsupportedKeywords(schema)).toEqual([]);
}
