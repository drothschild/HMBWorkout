/**
 * Anthropic client tests
 * Tests request/response/error mapping, network vs HTTP error distinctness
 */

import {
  createAnthropicClient,
  AnthropicUnreachable,
  AnthropicHttpError,
} from './anthropicClient';
import { AI_TURN_SCHEMA, DraftValidationError } from './draftSchema';

describe('Anthropic Client', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  describe('chat', () => {
    it('parses successful response with thinking block before text block', async () => {
      const responseBody = {
        content: [
          { type: 'thinking', thinking: '' },
          {
            type: 'text',
            text: JSON.stringify({
              reply: 'Here is a plan',
              draft: {
                name: 'Push Day',
                exercises: [
                  {
                    title: 'Bench Press',
                    kind: 'strength',
                    targetSets: 3,
                    targetReps: 8,
                  },
                ],
              },
            }),
          },
        ],
        stop_reason: 'end_turn',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(responseBody),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);
      const result = await client.chat({
        system: 'You are a workout coach',
        messages: [{ role: 'user', content: 'Create a push day routine' }],
      });

      expect(result.reply).toBe('Here is a plan');
      expect(result.draft?.name).toBe('Push Day');
      expect(result.draft?.exercises[0].title).toBe('Bench Press');
      expect(result.draft?.exercises[0].kind).toBe('strength');
      expect(result.draft?.exercises[0].targetSets).toBe(3);
      expect(result.draft?.exercises[0].targetReps).toBe(8);
    });

    it('includes correct URL, method, headers, and body structure in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ reply: 'test' }),
            },
          ],
          stop_reason: 'end_turn',
        }),
      });

      const apiKey = 'test-api-key-123';
      const systemPrompt = 'You are a coach';
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: '{"reply": "Hi"}' },
      ];

      const client = createAnthropicClient({ apiKey }, mockFetch);
      await client.chat({ system: systemPrompt, messages });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      // Verify URL
      expect(url).toBe('https://api.anthropic.com/v1/messages');

      // Verify method
      expect(options.method).toBe('POST');

      // Verify headers
      expect(options.headers['x-api-key']).toBe(apiKey);
      expect(options.headers['anthropic-version']).toBe('2023-06-01');
      expect(options.headers['content-type']).toBe('application/json');

      // Verify body
      const body = JSON.parse(options.body);
      expect(body.model).toBe('claude-sonnet-5');
      expect(body.max_tokens).toBe(4096);
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.system).toBe(systemPrompt);
      expect(body.messages).toEqual(messages);
      expect(body.output_config.format.type).toBe('json_schema');
      expect(body.output_config.format.schema).toEqual(AI_TURN_SCHEMA);
    });

    it('throws AnthropicHttpError on 401 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce('Unauthorized'),
      });

      const client = createAnthropicClient({ apiKey: 'invalid-key' }, mockFetch);
      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AnthropicHttpError);
      if (error instanceof AnthropicHttpError) {
        expect(error.status).toBe(401);
      }
    });

    it('throws AnthropicHttpError on non-401 HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValueOnce('Internal Server Error'),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);
      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AnthropicHttpError);
      if (error instanceof AnthropicHttpError) {
        expect(error.status).toBe(500);
      }
    });

    it('throws AnthropicUnreachable on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);

      await expect(
        client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow(AnthropicUnreachable);
    });

    it('throws DraftValidationError when json() rejects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockRejectedValueOnce(new Error('Invalid JSON')),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);

      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DraftValidationError);
    });

    it('throws DraftValidationError when response has no text block', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          content: [{ type: 'thinking', thinking: 'some thinking' }],
          stop_reason: 'end_turn',
        }),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);

      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DraftValidationError);
    });

    it('throws DraftValidationError when text block is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          content: [{ type: 'text', text: '' }],
          stop_reason: 'end_turn',
        }),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);

      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DraftValidationError);
    });

    it('throws DraftValidationError when text is not valid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          content: [{ type: 'text', text: 'not valid json {]' }],
          stop_reason: 'end_turn',
        }),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);

      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DraftValidationError);
    });

    it('throws DraftValidationError when JSON fails AiTurn validation (missing reply)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ draft: { name: 'Test' } }),
            },
          ],
          stop_reason: 'end_turn',
        }),
      });

      const client = createAnthropicClient({ apiKey: 'test-key' }, mockFetch);

      const error = await client
        .chat({
          system: 'test',
          messages: [{ role: 'user', content: 'test' }],
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DraftValidationError);
    });
  });

  describe('error types', () => {
    it('AnthropicUnreachable and AnthropicHttpError are distinct', () => {
      const unreachable = new AnthropicUnreachable('Network error');
      const httpError = new AnthropicHttpError(401, 'Unauthorized');

      expect(unreachable).toBeInstanceOf(AnthropicUnreachable);
      expect(unreachable).not.toBeInstanceOf(AnthropicHttpError);
      expect(httpError).toBeInstanceOf(AnthropicHttpError);
      expect(httpError).not.toBeInstanceOf(AnthropicUnreachable);
    });
  });

  describe('default fetch', () => {
    it('uses global fetch when not provided', () => {
      const client = createAnthropicClient({ apiKey: 'test-key' });

      // Verify the client was created successfully (no throw)
      expect(client).toBeDefined();
    });
  });
});
