import { createOpenaiExerciseQuestionClient } from './openaiExerciseQuestionClient';
import { OpenaiUnreachable, OpenaiHttpError, OpenaiIncompleteError, OpenaiRefusalError } from './openaiClient';

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

    it('uses correct token budget for exerciseQuestion surface (Q13)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'Answer text',
            }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);
      await client.ask({
        system: 'test',
        message: 'test',
      });

      // KILL Q13: surface: 'exerciseQuestion' → 'chat' would use 4096 instead of 512
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_output_tokens).toBe(512);
    });

    it('uses correct model for exercise questions (Q01)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'Answer text',
            }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);
      await client.ask({
        system: 'test',
        message: 'test',
      });

      // KILL Q01: MODEL = 'gpt-5.6-sol' → 'gpt-4o' changes the model
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-5.6-sol');
    });

    it('detects incomplete response status (Q11)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'token_limit' },
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'Partial answer',
            }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      // KILL Q11: if (status === 'incomplete') → if (false) would skip this check
      await expect(
        client.ask({ system: 'test', message: 'test' })
      ).rejects.toThrow(OpenaiIncompleteError);
      expect.assertions(1);
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

    it('throws OpenaiHttpError on HTTP error (survivor: if (!response.ok))', async () => {
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

    it('detects refusal in response (Q12)', async () => {
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

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      // KILL Q12: refusal check → if (false) would skip refusal detection
      await expect(
        client.ask({ system: 'test', message: 'test' })
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

    it('verifies output block type is output_text, not text (survivor: output_text → text)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{
              type: 'text',
              text: 'Here is how to do a proper push-up...',
            }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch as any);

      // Should fail because block type is 'text' not 'output_text'
      await expect(
        client.ask({ system: 'test', message: 'How?' })
      ).rejects.toThrow('response contains no usable question text');
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
              text: 'Answer text',
            }],
          }],
        }),
      });

      const client = createOpenaiExerciseQuestionClient({ apiKey: 'correct-key' }, mockFetch as any);
      await client.ask({
        system: 'test',
        message: 'test',
      });

      // Verify correct Bearer token is sent
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers.authorization).toBe('Bearer correct-key');
      expect(callArgs.headers.authorization).not.toBe('Bearer WRONG');
      expect.assertions(2);
    });
  });
});
