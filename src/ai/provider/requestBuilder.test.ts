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
    it('builds correct Responses API request for OpenAI', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      expect(body).toEqual({
        model: 'gpt-5.6-sol',
        max_tokens: 4096,
        messages: [
          {
            role: 'user' as const,
            content: 'You are a helpful assistant\n\nHello',
          },
        ],
        text: {
          type: 'text',
          format: {
            type: 'json_schema',
            strict: true,
            name: 'TestSchema',
            schema: testSchema,
          },
        },
      });
    });

    it('uses custom model', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-terra');
      expect(body.model).toBe('gpt-5.6-terra');
    });

    it('combines system and messages into single user message', () => {
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
      const messages = body.messages as Array<Record<string, unknown>>;

      // OpenAI Messages API requires user to speak first
      // System goes into the first message content
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'You are an AI coach\n\nFirst',
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

    it('text output format must be object with format field', () => {
      const body = buildOpenAiBody(testRequest, 'gpt-5.6-sol');

      expect(body.text).toEqual({
        type: 'text',
        format: {
          type: 'json_schema',
          strict: true,
          name: expect.any(String),
          schema: expect.any(Object),
        },
      });
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
      expect(openaiFormat.schema).toBe(testSchema);
    });
  });
});
