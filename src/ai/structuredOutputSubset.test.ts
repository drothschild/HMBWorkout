import { UNSUPPORTED_SCHEMA_KEYWORDS, findUnsupportedKeywords } from './structuredOutputSubset';

describe('findUnsupportedKeywords', () => {
  it('passes a schema built from the supported subset', () => {
    expect(
      findUnsupportedKeywords({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A name' },
          kind: { type: 'string', enum: ['strength', 'duration'] },
          when: { type: 'string', format: 'date' },
        },
        required: ['title'],
        additionalProperties: false,
      })
    ).toEqual([]);
  });

  it('reports array-count keywords with the path that carries them', () => {
    expect(
      findUnsupportedKeywords({
        type: 'object',
        properties: {
          alternates: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
        },
      })
    ).toEqual(['$.properties.alternates.minItems', '$.properties.alternates.maxItems']);
  });

  it('reaches violations nested inside items', () => {
    expect(
      findUnsupportedKeywords({
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string', maxLength: 80 } },
        },
      })
    ).toEqual(['$.items.properties.title.maxLength']);
  });

  it('reaches violations inside schema arrays such as anyOf', () => {
    expect(
      findUnsupportedKeywords({
        anyOf: [{ type: 'string' }, { type: 'integer', minimum: 1 }],
      })
    ).toEqual(['$.anyOf[1].minimum']);
  });

  // A property *named* like a keyword is not a keyword — it is a field the model
  // is being asked to return. Without this distinction the guard would reject
  // any schema with a `pattern` or `maximum` field, which is legal.
  it('ignores property names that collide with keywords', () => {
    expect(
      findUnsupportedKeywords({
        type: 'object',
        properties: { pattern: { type: 'string' }, maximum: { type: 'string' } },
      })
    ).toEqual([]);
  });

  it('lists every keyword it guards against', () => {
    // Pinned so that widening or narrowing the guard is a deliberate edit with
    // a reviewer looking at it, not a silent drift.
    expect([...UNSUPPORTED_SCHEMA_KEYWORDS].sort()).toEqual([
      'exclusiveMaximum',
      'exclusiveMinimum',
      'maxItems',
      'maxLength',
      'maxProperties',
      'maximum',
      'minItems',
      'minLength',
      'minProperties',
      'minimum',
      'multipleOf',
      'pattern',
      'uniqueItems',
    ]);
  });
});
