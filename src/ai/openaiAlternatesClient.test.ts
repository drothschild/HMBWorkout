import { createOpenaiAlternatesClient } from './openaiAlternatesClient';
import { OpenaiUnreachable, OpenaiHttpError } from './openaiClient';

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

    it('throws OpenaiHttpError on HTTP error', async () => {
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
  });
});
