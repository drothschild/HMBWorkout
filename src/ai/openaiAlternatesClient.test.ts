import { createOpenaiAlternatesClient } from './openaiAlternatesClient';
import { OpenaiUnreachable, OpenaiHttpError, OpenaiIncompleteError, OpenaiRefusalError } from './openaiClient';

describe('openaiAlternatesClient', () => {
  describe('createOpenaiAlternatesClient', () => {
    it('sends request to Responses endpoint with correct format', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: '{"alternates": [{"title": "Alt 1", "description": "Desc 1"}]}',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.suggest({
        system: 'You are a helpful exercise coach.',
        message: 'Suggest alternatives to Push-ups',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer test-key',
            'content-type': 'application/json',
          }),
        })
      );

      // Verify request body uses correct format
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.input).toEqual([
        { role: 'developer', content: 'You are a helpful exercise coach.' },
        { role: 'user', content: 'Suggest alternatives to Push-ups' },
      ]);

      // Verify reasoning is disabled
      expect(callBody.reasoning).toEqual({ effort: 'none' });

      expect(result).toEqual({ alternates: [{ title: 'Alt 1', description: 'Desc 1' }] });
    });

    it('uses correct token budget for alternates surface (A09)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: '{"alternates": [{"title": "Alt 1", "description": "Desc 1"}]}',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);
      await client.suggest({
        system: 'test',
        message: 'test',
      });

      // KILL A09: surface: 'alternates' → 'chat' would use 4096 instead of 1024
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_output_tokens).toBe(1024);
    });

    it('uses correct model for alternates (A01)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: '{"alternates": [{"title": "Alt 1", "description": "Desc 1"}]}',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);
      await client.suggest({
        system: 'test',
        message: 'test',
      });

      // KILL A01: MODEL = 'gpt-5.6-sol' → 'gpt-4o' changes the model
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-5.6-sol');
    });

    it('throws OpenaiUnreachable on network error', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Network timeout'));
      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.suggest({
          system: 'test',
          message: 'suggest alternatives',
        })
      ).rejects.toThrow(OpenaiUnreachable);
      expect.assertions(1);
    });

    it('detects incomplete response status (A07)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'token_limit' },
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: '{"alternates": []}',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      // KILL A07: if (status === 'incomplete') → if (false) would skip this check
      await expect(
        client.suggest({ system: 'test', message: 'test' })
      ).rejects.toThrow(OpenaiIncompleteError);
      expect.assertions(1);
    });

    it('throws OpenaiHttpError on HTTP error (survivor: if (!response.ok))', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      const error = await client
        .suggest({ system: 'test', message: 'suggest' })
        .catch((e: unknown) => e) as OpenaiHttpError;

      expect(error).toBeInstanceOf(OpenaiHttpError);
      expect(error.status).toBe(401);
      expect.assertions(2);
    });

    it('detects refusal in response (A08)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'refusal',
              refusal: 'I cannot help with that',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      // KILL A08: refusal check → if (false) would skip refusal detection
      await expect(
        client.suggest({ system: 'test', message: 'test' })
      ).rejects.toThrow(OpenaiRefusalError);
      expect.assertions(1);
    });

    it('throws when response has no message item', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'reasoning', content: [] }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.suggest({ system: 'test', message: 'suggest' })
      ).rejects.toThrow('response output contains no message item');
      expect.assertions(1);
    });

    it('throws when response has wrong format', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wrong: 'format' }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.suggest({ system: 'test', message: 'suggest' })
      ).rejects.toThrow('response output is not an array');
      expect.assertions(1);
    });

    it('verifies output block type is output_text, not text (survivor: output_text → text)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'text',
              text: '{"alternates": [{"title": "Alt 1", "description": "Desc 1"}]}',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'test-key' }, mockFetch as any);

      // Should fail because block type is 'text' not 'output_text'
      await expect(
        client.suggest({ system: 'test', message: 'test' })
      ).rejects.toThrow('response contains no text content block');
      expect.assertions(1);
    });

    it('verifies authorization header format (survivor: Bearer WRONG)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: '{"alternates": [{"title": "Alt 1", "description": "Desc 1"}]}',
            }],
          }],
        }),
      });

      const client = createOpenaiAlternatesClient({ apiKey: 'correct-key' }, mockFetch as any);
      await client.suggest({
        system: 'test',
        message: 'test',
      });

      // Verify correct Bearer token is sent
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers.authorization).toBe('Bearer correct-key');
      expect.assertions(1);
    });
  });
});
