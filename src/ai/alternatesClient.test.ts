/**
 * The one-shot alternates call. Same conventions as the rest of `src/ai`:
 * hand-rolled fetch (no SDK), `fetchFn`-injectable so it tests in the node
 * project, and `AnthropicUnreachable` vs `AnthropicHttpError` kept distinct.
 *
 * It lives in its own module rather than as a third method on
 * `anthropicClient.ts` so the conversational client stays hardwired to
 * `AI_TURN_SCHEMA`; this one is hardwired to `ALTERNATES_SCHEMA`.
 */

import { createExerciseAlternatesClient } from './alternatesClient';
import { AnthropicHttpError, AnthropicUnreachable } from './anthropicClient';
import { ALTERNATES_SCHEMA } from './alternatesSchema';
import { DraftValidationError } from './draftSchema';

const PAYLOAD = {
  alternates: [
    { title: 'Dumbbell Floor Press', description: 'Press from the floor, elbows tucked.' },
    { title: 'Machine Chest Press', description: 'Seated press against a fixed path.' },
    { title: 'Weighted Push Up', description: 'Push up with a plate across the upper back.' },
  ],
};

function jsonResponse(value: unknown) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(value) }],
      stop_reason: 'end_turn',
    }),
  };
}

describe('createExerciseAlternatesClient', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  it('posts the prompt to the Messages API with the key header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(PAYLOAD));

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);
    await client.suggest({ system: 'You are a coach', message: '## Replace\n\nBench Press' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect(options.headers['x-api-key']).toBe('test-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(options.body);
    expect(body.system).toBe('You are a coach');
    expect(body.messages).toEqual([{ role: 'user', content: '## Replace\n\nBench Press' }]);
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('asks for structured output against the alternates schema, not the turn schema', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(PAYLOAD));

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);
    await client.suggest({ system: 's', message: 'm' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema).toEqual(ALTERNATES_SCHEMA);
  });

  it('validates on receipt — structured output is not a guarantee', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ alternates: [{ title: 'No Description' }] }));

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.suggest({ system: 's', message: 'm' })).rejects.toThrow(
      DraftValidationError
    );
  });

  it('returns the validated alternates', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(PAYLOAD));

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);
    const result = await client.suggest({ system: 's', message: 'm' });

    expect(result.alternates).toHaveLength(3);
    expect(result.alternates[0].title).toBe('Dumbbell Floor Press');
  });

  it('raises AnthropicUnreachable when the network throws', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.suggest({ system: 's', message: 'm' })).rejects.toThrow(
      AnthropicUnreachable
    );
  });

  it('raises AnthropicHttpError, carrying the status, on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('rate limited'),
    });

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);

    const error = await client.suggest({ system: 's', message: 'm' }).catch((e) => e);

    expect(error).toBeInstanceOf(AnthropicHttpError);
    expect(error.status).toBe(429);
    expect(error.message).toContain('rate limited');
  });

  it('raises a validation error when the response carries no text block', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: [], stop_reason: 'max_tokens' }),
    });

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.suggest({ system: 's', message: 'm' })).rejects.toThrow(
      DraftValidationError
    );
  });

  it('raises a validation error when the body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });

    const client = createExerciseAlternatesClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.suggest({ system: 's', message: 'm' })).rejects.toThrow(
      DraftValidationError
    );
  });
});
