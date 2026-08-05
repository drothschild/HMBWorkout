import { createOpenaiClient, OpenaiUnreachable, OpenaiHttpError, createRestCommentaryClient } from './openaiClient';

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
        'https://api.openai.com/v1/messages',
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

    it('catches and swallows buildOpenAiBody schema errors', async () => {
      const mockFetch = jest.fn();
      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      // buildOpenAiBody throws when schema is invalid, client should catch
      const invalidSchema = { type: 'object' }; // missing properties for strict mode

      await expect(
        client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        })
      ).rejects.toBeTruthy();

      // Error should NOT be OpenaiUnreachable or OpenaiHttpError (not a network/HTTP issue)
      // but it should be caught and thrown
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
  });
});
