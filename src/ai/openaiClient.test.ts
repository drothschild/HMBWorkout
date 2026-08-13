import {
  createOpenaiClient,
  OpenaiUnreachable,
  OpenaiHttpError,
  OpenaiSchemaError,
  OpenaiIncompleteError,
  OpenaiRefusalError,
  createRestCommentaryClient,
} from './openaiClient';

describe('openaiClient', () => {
  describe('createOpenaiClient', () => {
    it('sends messages in Responses format with developer role for system', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{"reply": "test response"}' }] }],
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
      expect(callBody.text?.format?.name).toBe('AiTurn');
      expect(callBody.text?.format?.strict).toBe(true);
      expect(callBody.text?.format?.schema).toBeDefined();

      // C1.4: Verify default model is used when not configured
      expect(callBody.model).toBe('gpt-5.6-sol');

      expect(result).toEqual({ reply: 'test response' });
    });

    it('C1.5: uses configured model when provided (openai chat)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{"reply": "ok"}' }] }],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key', model: 'gpt-4-turbo' }, mockFetch as any);
      await client.chat({
        system: 'test',
        messages: [{ role: 'user', content: 'hello' }],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-4-turbo');
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
      expect.assertions(1);
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
      expect.assertions(2);
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
      expect.assertions(1);
    });

    it('throws on missing text content', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [{ type: 'message', content: [] }] }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        })
      ).rejects.toThrow();
      expect.assertions(1);
    });

    it('does not expose apiKey in network error messages', async () => {
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
      expect.assertions(1);
    });

    it('does not expose apiKey in HTTP error messages', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized - check your key',
      });
      const client = createOpenaiClient({ apiKey: 'super-secret-key-456' }, mockFetch as any);

      try {
        await client.chat({
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        });
      } catch (error) {
        const message = (error as Error).toString();
        expect(message).not.toContain('super-secret-key-456');
      }
      expect.assertions(1);
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
    it('surfaces a refusal part as OpenaiRefusalError, not "no text content block"', async () => {
      // A `refusal` part is a documented, normal Responses outcome. Round 3's
      // review found it was claimed as handled but never implemented, so it fell
      // through to the no-text-block error — which points a reader at the wire
      // format instead of at the model's actual decision.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);
      const error = await client
        .chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OpenaiRefusalError);
      expect((error as OpenaiRefusalError).refusal).toBe('I cannot help with that.');
      expect((error as Error).message).not.toMatch(/no text content block/);
    });

    it('requires the output_text part type — an Anthropic-shaped text part is rejected', async () => {
      // This pins the discriminator itself, because the code and the mocks were
      // wrong TOGETHER twice on this PR. First the parser read a top-level
      // `content[]` (Anthropic) instead of `output[]`, and the mocks matched, so
      // mutating the code to the correct shape was KILLED by the suite — the
      // tests enforced the bug. Fixing the wrapper left the same defect one level
      // down: parts were still matched on `type: 'text'`, Anthropic's name,
      // rather than `output_text`, and again the mocks agreed.
      //
      // A green suite cannot catch that class on its own; only an assertion that
      // the WRONG shape is rejected can. Feed a real OpenAI envelope carrying
      // Anthropic's part type and require it to fail.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'text', text: '{"reply": "nope"}' }] }],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/no text content block/);
      expect.assertions(1);
    });

    it('posts to the OpenAI Responses endpoint and parses the turn', async () => {
      const mockFetch = jest.fn();
      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{"reply": "response"}' }] }],
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

    it('uses correct token budget: 4096 for chat surface, not 256', async () => {
      const captured: { maxTokens?: number } = {};
      const mockFetch = jest.fn(async (_url: string, init: { body: string }) => {
        captured.maxTokens = (JSON.parse(init.body) as { max_output_tokens?: number }).max_output_tokens;
        throw new Error('stop here');
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as never);
      await client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});

      // Chat surface should use 4096, not 256
      expect(captured.maxTokens).toBe(4096);
      expect.assertions(1);
    });

    it('finds message item when reasoning items precede it', async () => {
      // Reasoning items may appear in output and carry their own content array.
      // The message item guard must skip non-message types to find the actual output.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [
            { type: 'reasoning', content: [{ type: 'text', text: 'thinking...' }] },
            { type: 'message', content: [{ type: 'output_text', text: '{"reply": "answer"}' }] },
          ],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] });

      expect(result).toEqual({ reply: 'answer' });
      expect.assertions(1);
    });

    it('throws when no message item is found (all items are reasoning)', async () => {
      // If output contains only non-message items (e.g., only reasoning), there is no
      // message item to extract. This is a model-side incomplete response.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'reasoning', content: [{ type: 'text', text: 'thinking...' }] }],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/no message item/);
      expect.assertions(1);
    });

    it('handles top-level error in response body', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: { message: 'Invalid schema provided' },
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/OpenAI error: Invalid schema provided/);
      expect.assertions(1);
    });

    it('handles incomplete response with max_tokens reason', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_tokens' },
          output: [],
        }),
      });

      const client = createOpenaiClient({ apiKey: 'test-key' }, mockFetch as any);

      try {
        await client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // Assert the TYPE, not just the message. Round 3's review found that
        // swapping OpenaiIncompleteError for DraftValidationError survived
        // mutation, because both tests only checked `instanceof Error` plus a
        // substring — so the new class's entire reason for existing (letting a
        // caller distinguish "the model ran out of budget" from "the model sent
        // us garbage") was unpinned.
        expect(error).toBeInstanceOf(OpenaiIncompleteError);
        expect((error as OpenaiIncompleteError).reason).toBe('max_tokens');
        expect((error as Error).message).toContain('incomplete');
        expect((error as Error).message).toContain('max_tokens');
      }
      expect.assertions(5);
    });
  });

  describe('createRestCommentaryClient', () => {
    it('sends rest commentary request with Responses format', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Keep pushing!' }] }],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.comment({
        system: 'Be brief',
        message: 'Time for set 3',
      });

      expect(result).toBe('Keep pushing!');

      // Explicitly disabled, not absent: an omitted `reasoning` field means effort
      // 'medium' on GPT-5.6, which would exhaust this surface's 256-token ceiling
      // before any prose is produced.
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-5.6-sol');
      expect(callBody.reasoning).toEqual({ effort: 'none' });
      expect(callBody.max_output_tokens).toBe(256); // getTokenBudget('restCommentary')

      // Verify developer role is preserved for system instructions
      const developerInput = callBody.input?.find((entry: any) => entry.role === 'developer');
      expect(developerInput?.content).toBe('Be brief');

      // Verify text format for plain text output
      expect(callBody.text?.format?.type).toBe('text');
    });

    it('C1.9: uses configured model when provided (openai rest commentary)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Go!' }] }],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key', model: 'gpt-4o-mini' }, mockFetch as any);
      await client.comment({ system: 'test', message: 'test' });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-4o-mini');
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
      expect.assertions(1);
    });

    it('throws on empty text response', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.comment({
          system: 'test',
          message: 'hi',
        })
      ).rejects.toThrow();
      expect.assertions(1);
    });

    it('does not expose apiKey in network error messages', async () => {
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
      expect.assertions(1);
    });

    it('does not expose apiKey in HTTP error messages', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Access forbidden',
      });
      const client = createRestCommentaryClient({ apiKey: 'secret-789' }, mockFetch as any);

      try {
        await client.comment({
          system: 'test',
          message: 'hi',
        });
      } catch (error) {
        const message = (error as Error).toString();
        expect(message).not.toContain('secret-789');
      }
      expect.assertions(1);
    });

    it('requires output_text part type on commentary — an Anthropic-shaped text part is rejected', async () => {
      // Mirror of the chat-surface pin: this surface must also reject Anthropic's
      // 'text' discriminator and only accept OpenAI's 'output_text'.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'text', text: 'nope' }] }],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);

      await expect(
        client.comment({ system: 'test', message: 'hi' })
      ).rejects.toThrow(/no usable commentary text/);
      expect.assertions(1);
    });

    it('finds message item on commentary when reasoning items precede it', async () => {
      // Reasoning items may appear in output. Commentary surface must also skip
      // non-message types to find the message item carrying the actual response.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [
            { type: 'reasoning', content: [{ type: 'text', text: 'thinking...' }] },
            { type: 'message', content: [{ type: 'output_text', text: 'Keep going!' }] },
          ],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);
      const result = await client.comment({ system: 'test', message: 'hi' });

      expect(result).toBe('Keep going!');
      expect.assertions(1);
    });

    it('surfaces a refusal on the COMMENTARY surface too, not "no usable commentary text"', async () => {
      // The chat surface got this pin when refusal handling was added; the
      // commentary copy did not, and round 4's review found two mutations
      // surviving on it — deleting the block outright, and breaking its
      // discriminator so the guard can never match. Both left 441/441 green.
      //
      // The manager's "mutation-verified, full-file" claim for that commit had
      // measured only the chat surface, which is the same defect one layer down
      // from the one being fixed: present in code, absent from tests, on a
      // surface that swallows every error at runtime.
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Not something I can advise on.' }] }],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);
      const error = await client
        .comment({ system: 'Be brief', message: 'Time for set 3' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OpenaiRefusalError);
      expect((error as OpenaiRefusalError).refusal).toBe('Not something I can advise on.');
      expect((error as Error).message).not.toMatch(/no usable commentary text/);
    });

    it('handles incomplete response on commentary (critical with tight token budget)', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_tokens' },
          output: [],
        }),
      });

      const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch as any);

      try {
        await client.comment({ system: 'test', message: 'hi' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // Assert the TYPE, not just the message. Round 3's review found that
        // swapping OpenaiIncompleteError for DraftValidationError survived
        // mutation, because both tests only checked `instanceof Error` plus a
        // substring — so the new class's entire reason for existing (letting a
        // caller distinguish "the model ran out of budget" from "the model sent
        // us garbage") was unpinned.
        expect(error).toBeInstanceOf(OpenaiIncompleteError);
        expect((error as OpenaiIncompleteError).reason).toBe('max_tokens');
        expect((error as Error).message).toContain('incomplete');
        expect((error as Error).message).toContain('max_tokens');
      }
      expect.assertions(5);
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
