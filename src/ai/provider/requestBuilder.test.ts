import { buildAnthropicBody, buildOpenAiBody } from './requestBuilder';

describe('request builders', () => {
  const testSchema = {
    type: 'object' as const,
    properties: {
      reply: { type: 'string' },
      data: { type: 'object' },
    },
    required: ['reply'],
    additionalProperties: false,
  };

  const testRequest = {
    system: 'You are a helpful assistant',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    schema: testSchema,
    schemaName: 'TestSchema',
    surface: 'chat' as const,
  };

  describe('buildAnthropicBody', () => {
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
      const surfaces: Array<[string, number]> = [
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
      expect(body.system).toBe('You are an AI coach');
      expect(body.messages).toEqual(multiTurnRequest.messages);
    });
  });

  describe('buildOpenAiBody', () => {
    it('builds correct OpenAI request with separate system prompt', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      expect(body).toEqual({
        model: 'gpt-5.6-sol',
        max_tokens: 4096,
        system: 'You are a helpful assistant',
        messages: [
          {
            role: 'user' as const,
            content: 'Hello',
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'TestSchema',
            schema: testSchema,
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
      const surfaces: Array<[string, number]> = [
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
        expect(body.max_tokens).toBe(expectedTokens);
      }
    });

    it('applies low reasoning effort for rest commentary', () => {
      const body = buildOpenAiBody(
        { ...testRequest, surface: 'restCommentary' as const },
        'gpt-5.6-sol'
      );
      expect(body.reasoning_effort).toBe('low');
    });

    it('does not set reasoning effort for other surfaces', () => {
      for (const surface of ['chat', 'alternates', 'exerciseQuestion']) {
        const body = buildOpenAiBody(
          { ...testRequest, surface: surface as any },
          'gpt-5.6-sol'
        );
        expect(body.reasoning_effort).toBeUndefined();
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

      // System is kept separate in its own field
      expect(body.system).toBe('You are an AI coach');

      // Messages are unchanged
      const messages = body.messages as Record<string, unknown>[];
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

    it('response_format must be json_schema with strict mode', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
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

    it('OpenAI request does not mutate schema', () => {
      const originalSchema = { ...testSchema };
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      // Schema in request should be unchanged
      expect(testRequest.schema).toEqual(originalSchema);

      // Schema in body should be the same reference (not copied)
      const openaiFormat = (body.response_format as Record<string, unknown>).json_schema as Record<
        string,
        unknown
      >;
      expect(openaiFormat.schema).toBe(testSchema);
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
      const openaiFormat = ((openai.response_format as Record<string, unknown>).json_schema as Record<
        string,
        unknown
      >);

      expect(anthropicFormat.schema).toBe(testSchema);
      expect(openaiFormat.schema).toBe(testSchema);
    });
  });
});
