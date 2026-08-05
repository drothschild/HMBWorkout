import { buildAnthropicBody, buildOpenAiBody } from './requestBuilder';

describe('request builders', () => {
  const testSchema = Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      reply: { type: 'string' },
      data: { type: 'object' },
    }),
    required: ['reply'],
    additionalProperties: false,
  });

  const testRequest = {
    system: 'You are a helpful assistant',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    schema: testSchema,
    schemaName: 'TestSchema',
    surface: 'chat' as const,
  };

/** Captured at module load — see the immutability test below for why. */
const PRISTINE_TEST_SCHEMA = JSON.stringify(testSchema);

  describe('buildAnthropicBody', () => {
    it('throws on schema with unsupported keywords for Anthropic', () => {
      const schemaWithUnsupported = {
        type: 'object',
        properties: {
          reply: { type: 'string', minItems: 1 },
        },
        required: ['reply'],
        additionalProperties: false,
      };

      expect(() =>
        buildAnthropicBody(
          {
            system: 'Test',
            messages: [{ role: 'user' as const, content: 'Test' }],
            schema: schemaWithUnsupported,
            schemaName: 'BadSchema',
          },
          'claude-sonnet-5'
        )
      ).toThrow(/unsupported keywords.*Anthropic/i);
    });

    it('builds correct request for Anthropic API', () => {
      const body = buildAnthropicBody(testRequest, 'claude-sonnet-5');

      expect(body).toEqual({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        system: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hello' }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: testSchema,
          },
        },
      });
    });

    it('respects custom model', () => {
      const body = buildAnthropicBody(testRequest, 'claude-haiku-3.5');
      expect(body.model).toBe('claude-haiku-3.5');
    });

    it('uses correct token budget for each surface', () => {
      const surfaces: [string, number][] = [
        ['chat', 4096],
        ['alternates', 1024],
        ['exerciseQuestion', 512],
        ['restCommentary', 256],
      ];

      for (const [surface, expectedTokens] of surfaces) {
        const body = buildAnthropicBody(
          { ...testRequest, surface: surface as any },
          'claude-sonnet-5'
        );
        expect(body.max_tokens).toBe(expectedTokens);
      }
    });

    it('preserves system and messages as-is', () => {
      const multiTurnRequest = {
        ...testRequest,
        messages: [
          { role: 'user' as const, content: 'First' },
          { role: 'assistant' as const, content: 'Reply' },
          { role: 'user' as const, content: 'Second' },
        ],
        system: 'You are an AI coach',
      };

      const body = buildAnthropicBody(multiTurnRequest, 'claude-sonnet-5');
      // Anthropic keeps a top-level `system` and `messages` — unchanged, and
      // deliberately so: this body must stay byte-identical to what
      // anthropicClient.ts already sends.
      expect(body.system).toBe('You are an AI coach');
      expect(body.messages).toEqual(multiTurnRequest.messages);
    });
  });

  describe('buildOpenAiBody', () => {
    it('builds correct OpenAI request with separate system prompt', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      expect(body).toEqual({
        model: 'gpt-5.6-sol',
        max_output_tokens: 4096,
        // Responses API: no top-level `system`. System content is a
        // role-tagged entry in `input`, which is what keeps
        // IMMUTABLE_DIRECTIVES in their own channel rather than sharing a
        // buffer with user-controlled text.
        input: [
          { role: 'developer', content: 'You are a helpful assistant' },
          {
            role: 'user' as const,
            content: 'Hello',
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'TestSchema',
            schema: expect.objectContaining({
              type: 'object',
              required: expect.arrayContaining(['reply', 'data']),
              additionalProperties: false,
            }),
            strict: true,
          },
        },
      });
    });

    it('uses custom model', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-terra');
      expect(body.model).toBe('gpt-5.6-terra');
    });

    it('uses correct token budget for each surface', () => {
      const surfaces: [string, number][] = [
        ['chat', 4096],
        ['alternates', 1024],
        ['exerciseQuestion', 512],
        ['restCommentary', 256],
      ];

      for (const [surface, expectedTokens] of surfaces) {
        const body = buildOpenAiBody(
          { ...testRequest, surface: surface as any },
          'gpt-5.6-sol'
        );
        expect(body.max_output_tokens).toBe(expectedTokens);
      }
    });

    it('applies low reasoning effort for rest commentary', () => {
      const body = buildOpenAiBody(
        { ...testRequest, surface: 'restCommentary' as const },
        'gpt-5.6-sol'
      );
      expect(body.reasoning).toEqual({ effort: 'low' });
    });

    it('does not set reasoning for other surfaces', () => {
      for (const surface of ['chat', 'alternates', 'exerciseQuestion']) {
        const body = buildOpenAiBody(
          { ...testRequest, surface: surface as any },
          'gpt-5.6-sol'
        );
        expect(body.reasoning).toBeUndefined();
      }
    });

    it('keeps system and messages separate', () => {
      const multiTurnRequest = {
        ...testRequest,
        messages: [
          { role: 'user' as const, content: 'First' },
          { role: 'assistant' as const, content: 'Reply' },
          { role: 'user' as const, content: 'Second' },
        ],
        system: 'You are an AI coach',
      };

      const body = buildOpenAiBody(multiTurnRequest, 'gpt-5.6-sol') as Record<
        string,
        unknown
      >;

      // System is kept separate in its own field with role 'developer'
      const sysEntry = (body.input as Record<string, unknown>[])[0];
      expect(sysEntry).toEqual({ role: 'developer', content: 'You are an AI coach' });

      // Messages are unchanged
      const messages = (body.input as Record<string, unknown>[]).slice(1);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'First',
      });
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'Reply',
      });
      expect(messages[2]).toEqual({
        role: 'user',
        content: 'Second',
      });
    });

    it('requires schema name', () => {
      const bodyWithoutName = {
        system: 'Test',
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: testSchema,
        schemaName: '',
      };

      expect(() => buildOpenAiBody(bodyWithoutName, 'gpt-5.6-sol')).toThrow(
        /schema name required/i
      );
    });

    it('throws on schema with unsupported keywords', () => {
      const schemaWithUnsupported = {
        type: 'object',
        properties: {
          reply: { type: 'string', minLength: 1 },
        },
        required: ['reply'],
        additionalProperties: false,
      };

      expect(() =>
        buildOpenAiBody(
          {
            system: 'Test',
            messages: [{ role: 'user' as const, content: 'Test' }],
            schema: schemaWithUnsupported,
            schemaName: 'BadSchema',
          },
          'gpt-5.6-sol'
        )
      ).toThrow(/unsupported keywords/i);
    });

    it('transforms schema to meet strict mode requirements', () => {
      // A schema that's missing additionalProperties gets it added by the transform
      const schemaWithMissingAdditional = {
        type: 'object',
        properties: {
          reply: { type: 'string' },
        },
        required: ['reply'],
        // Deliberately missing additionalProperties — the transform adds it
      };

      const body = buildOpenAiBody(
        {
          system: 'Test',
          messages: [{ role: 'user' as const, content: 'Test' }],
          schema: schemaWithMissingAdditional,
          schemaName: 'TestSchema',
        },
        'gpt-5.6-sol'
      );

      // The transformed schema should have additionalProperties: false
      const transformedSchema = (body.text as Record<string, unknown>)
        .format as Record<string, unknown>;
      expect((transformedSchema.schema as Record<string, unknown>).additionalProperties).toBe(false);
    });

    it('text.format must be json_schema with strict mode', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      expect(body.text).toEqual({
        format: {
          type: 'json_schema',
          name: expect.any(String),
          schema: expect.any(Object),
          strict: true,
        },
      });
    });
  });

  describe('schema immutability', () => {
    it('Anthropic request does not mutate schema', () => {
      const originalSchema = { ...testSchema };
      const body = buildAnthropicBody(testRequest, 'claude-sonnet-5');

      // Schema in request should be unchanged
      expect(testRequest.schema).toEqual(originalSchema);

      // Schema in body should be the same reference (not copied)
      const anthropicFormat = (body.output_config as Record<string, unknown>)
        .format as Record<string, unknown>;
      expect(anthropicFormat.schema).toBe(testSchema);
    });

    it('OpenAI request does not mutate input schema', () => {
      // PRISTINE_TEST_SCHEMA is captured at module load. Snapshotting here
      // would be too late: seven earlier tests in this file already call
      // buildOpenAiBody against the same shared object, so a mutating builder
      // corrupts it before this line and the comparison passes anyway.
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      // Input schema should be unchanged
      expect(JSON.stringify(testRequest.schema)).toBe(PRISTINE_TEST_SCHEMA);

      // Schema in body is transformed (all properties required, optionals nullable)
      const openaiFormat = (body.text as Record<string, unknown>).format as Record<
        string,
        unknown
      >;
      expect(openaiFormat.schema).not.toBe(testSchema);
      expect(openaiFormat.schema).toEqual(
        expect.objectContaining({
          required: expect.arrayContaining(['reply', 'data']),
        })
      );
    });
  });

  describe('integration: both providers handle same input', () => {
    it('both accept the same request shape', () => {
      const request = {
        system: 'Be concise',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        schema: testSchema,
        schemaName: 'Response',
      };

      const anthropic = buildAnthropicBody(request, 'claude-sonnet-5') as Record<
        string,
        unknown
      >;
      const openai = buildOpenAiBody(request, 'gpt-5.6-sol') as Record<
        string,
        unknown
      >;

      // Both should succeed
      expect(anthropic).toBeDefined();
      expect(openai).toBeDefined();

      // Both should include the schema
      const anthropicFormat = (anthropic.output_config as Record<string, unknown>)
        .format as Record<string, unknown>;
      const openaiFormat = ((openai.text as Record<string, unknown>).format as Record<
        string,
        unknown
      >);

      expect(anthropicFormat.schema).toBe(testSchema);
      // OpenAI schema is transformed, not the original
      expect(openaiFormat.schema).not.toBe(testSchema);
      expect(openaiFormat.schema).toEqual(expect.objectContaining({
        type: 'object',
        required: expect.arrayContaining(['reply', 'data']),
      }));
    });
  });
});
