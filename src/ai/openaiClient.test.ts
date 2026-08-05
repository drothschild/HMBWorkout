import { createOpenaiClient, OpenaiUnreachable, OpenaiHttpError, OpenaiSchemaError, createRestCommentaryClient } from './openaiClient';

describe('openaiClient', () => {
  describe('createOpenaiClient', () => {
    it('sends messages in Responses format with developer role for system', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"reply": "test response"}' }],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.chat({
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer test-key',
          }),
        })
      );

      // Verify that system is in input array with developer role, not top-level
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.input).toEqual([
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ]);

      // Verify schema config is present
      expect(callBody.text?.format?.type).toBe('json_schema');
      expect(callBody.text?.format?.strict).toBe(true);

      expect(result).toEqual({ reply: 'test response' });
    });

    it('throws OpenaiUnreachable on network error', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Network timeout'));
      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        })
      ).rejects.toThrow(OpenaiUnreachable);
    });

    it('throws OpenaiHttpError on HTTP error', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid request',
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      const error = await client.chat({
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      }).catch((e: unknown) => e) as OpenaiHttpError;

      expect(error).toBeInstanceOf(OpenaiHttpError);
      expect(error.status).toBe(400);
    });

    it('throws on invalid JSON response', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('invalid json');
        },
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        })
      ).rejects.toThrow();
    });

    it('throws on missing text content', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [] }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        })
      ).rejects.toThrow();
    });

    it('does not expose apiKey in error messages', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Network failed'));
      const client = createOpenaiClient({ apiKey: 'super-secret-key-123' }, mockFetch as any);

      try {
        await client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        });
      } catch (error) {
        const message = (error as Error).toString();
        expect(message).not.toContain('super-secret-key-123');
      }
    });

    // NOTE ON A TEST THAT USED TO BE HERE. It was named "converts buildOpenAiBody
    // schema errors to OpenaiSchemaError" and did not test that: it built an
    // `invalidSchema` fixture it never used, passed the valid AI_TURN_SCHEMA
    // instead, and asserted `rejects.toBeTruthy()` — which passed only because a
    // bare `jest.fn()` returns undefined and the client then threw reading
    // `response.ok`. A rewrite kept the name while its own comments admitted it
    // was "just verifying the client setup doesn't break with valid inputs",
    // which is worse: a test that documents its own vacuity still reads as
    // coverage in a list of test names.
    //
    // The honest position is that the catch in openaiClient.ts is UNREACHABLE
    // today. The client hardcodes AI_TURN_SCHEMA and schemaName 'AiTurn', both
    // valid, so no caller can make buildOpenAiBody throw through this surface.
    // It stays as defence-in-depth and becomes reachable — and testable — when
    // Phase 3 lets callers supply a schema. buildOpenAiBody's own error cases are
    // covered where they are reachable, in provider/requestBuilder.test.ts.
    it('posts to the OpenAI Responses endpoint and parses the turn', async () => {
      const mockFetch = jest.fn();
      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"reply": "response"}' }],
        }),
      });

      const result = await client.chat({
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result).toEqual({ reply: 'response' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.any(Object)
      );
    });
  });

  describe('createRestCommentaryClient', () => {
    it('sends rest commentary request with Responses format', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Keep pushing!' }],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.comment({
        system: 'Be brief',
        message: 'Time for set 3',
      });

      expect(result).toBe('Keep pushing!');

      // Verify low effort was set for commentary
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.reasoning?.effort).toBe('low');
      expect(callBody.max_output_tokens).toBe(256); // COMMENTARY_MAX_TOKENS
    });

    it('throws OpenaiUnreachable on network error', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('timeout'));
      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.comment({
          system: 'test',
          message: 'hi',
        })
      ).rejects.toThrow(OpenaiUnreachable);
    });

    it('throws on empty text response', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '' }] }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.comment({
          system: 'test',
          message: 'hi',
        })
      ).rejects.toThrow();
    });

    it('does not expose apiKey in error messages', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('failed'));
      const client = createRestCommentaryClient({ apiKey: 'secret-456' }, mockFetch as any);

      try {
        await client.comment({
          system: 'test',
          message: 'hi',
        });
      } catch (error) {
        const message = (error as Error).toString();
        expect(message).not.toContain('secret-456');
      }
    });
  });

  describe('error classes', () => {
    it('OpenaiUnreachable has correct name', () => {
      const err = new OpenaiUnreachable('test message');
      expect(err.name).toBe('OpenaiUnreachable');
      expect(err.message).toBe('test message');
    });

    it('OpenaiHttpError has correct name and status', () => {
      const err = new OpenaiHttpError(401, 'unauthorized');
      expect(err.name).toBe('OpenaiHttpError');
      expect(err.status).toBe(401);
      expect(err.message).toBe('unauthorized');
    });

    it('OpenaiSchemaError has correct name', () => {
      const err = new OpenaiSchemaError('invalid schema');
      expect(err.name).toBe('OpenaiSchemaError');
      expect(err.message).toBe('invalid schema');
    });
  });
});
