/**
 * The one-shot commentary call: same conventions as `createAnthropicClient`
 * (hand-rolled fetch, fetchFn-injectable, AnthropicUnreachable vs
 * AnthropicHttpError), but plain text out and a small token budget — it runs
 * while a rest countdown is ticking.
 */

import {
  AnthropicHttpError,
  AnthropicUnreachable,
  createRestCommentaryClient,
} from './anthropicClient';
import { DraftValidationError } from './draftSchema';

function textResponse(text: string) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    }),
  };
}

describe('createRestCommentaryClient', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  it('posts the system and message to the Messages API with the key header', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Same weight, one more rep.'));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);
    await client.comment({ system: 'You are a coach', message: '## Up Next\n\nBench Press' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect(options.headers['x-api-key']).toBe('test-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(options.body);
    expect(body.system).toBe('You are a coach');
    expect(body.messages).toEqual([
      { role: 'user', content: '## Up Next\n\nBench Press' },
    ]);
  });

  it('keeps the token budget small and effort low — this runs against a ticking countdown', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Brace hard.'));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);
    await client.comment({ system: 's', message: 'm' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBeLessThanOrEqual(512);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config?.effort).toBe('low');
  });

  it('asks for prose, not the structured turn schema', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Brace hard.'));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);
    await client.comment({ system: 's', message: 'm' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.output_config?.format).toBeUndefined();
  });

  it('returns the raw comment text (normalization happens in the store)', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('  "Same weight,\n one more rep."  '));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);
    const comment = await client.comment({ system: 's', message: 'm' });

    // Client returns raw text; the store normalizes it
    expect(comment).toBe('  "Same weight,\n one more rep."  ');
  });

  it('skips a leading empty text block', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '' },
          { type: 'text', text: 'Chest up out of the hole.' },
        ],
      }),
    });

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.comment({ system: 's', message: 'm' })).resolves.toBe(
      'Chest up out of the hole.'
    );
  });

  it('throws AnthropicUnreachable when the network fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.comment({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      AnthropicUnreachable
    );
  });

  it('throws AnthropicHttpError with the status on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('unauthorized'),
    });

    const client = createRestCommentaryClient({ apiKey: 'bad-key' }, mockFetch);

    await expect(client.comment({ system: 's', message: 'm' })).rejects.toMatchObject({
      name: 'AnthropicHttpError',
      status: 401,
    });
  });

  it('throws DraftValidationError when the response carries no usable text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: [], stop_reason: 'max_tokens' }),
    });

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.comment({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      DraftValidationError
    );
  });

  it('throws DraftValidationError when the only text block is blank', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('   '));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.comment({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      DraftValidationError
    );
  });

  it('is a distinct error class hierarchy from a plain Error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const client = createRestCommentaryClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.comment({ system: 's', message: 'm' })).rejects.not.toBeInstanceOf(
      AnthropicHttpError
    );
  });
});
