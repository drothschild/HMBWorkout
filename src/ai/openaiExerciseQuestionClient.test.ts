import { createOpenaiExerciseQuestionClient } from './openaiExerciseQuestionClient';
import { OpenaiUnreachable, OpenaiHttpError } from './openaiClient';

describe('openaiExerciseQuestionClient', () => {
  describe('createOpenaiExerciseQuestionClient', () => {
    it('sends request to Responses endpoint with text format', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'Here is how to do a proper push-up...',
            }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.ask({
        system: 'You are a helpful exercise coach.',
        message: 'How do I do a proper push-up?',
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
        { role: 'user', content: 'How do I do a proper push-up?' },
      ]);

      // Verify text format is used (not json_schema)
      expect(callBody.text.format).toEqual({ type: 'text' });

      // Verify reasoning is disabled
      expect(callBody.reasoning).toEqual({ effort: 'none' });

      expect(result).toBe('Here is how to do a proper push-up...');
    });

    it('throws OpenaiUnreachable on network error', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Network timeout'));
      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.ask({
          system: 'test',
          message: 'How do I do this exercise?',
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

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      const error = await client
        .ask({ system: 'test', message: 'How?' })
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

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.ask({ system: 'test', message: 'How?' })
      ).rejects.toThrow('response output contains no message item');
      expect.assertions(1);
    });

    it('throws when response has wrong output format', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wrong: 'format' }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.ask({ system: 'test', message: 'How?' })
      ).rejects.toThrow('response output is not an array');
      expect.assertions(1);
    });

    it('throws when message content has no text block', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: '' }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.ask({ system: 'test', message: 'How?' })
      ).rejects.toThrow('response contains no usable question text');
      expect.assertions(1);
    });
  });
});
