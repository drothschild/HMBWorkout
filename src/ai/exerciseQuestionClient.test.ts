/**
 * The exercise-question one-shot call: same conventions as
 * `createAnthropicClient`/`createRestCommentaryClient` (hand-rolled fetch,
 * fetchFn-injectable, `AnthropicUnreachable` vs `AnthropicHttpError`), but
 * with its own, larger token budget — a "detailed how-to" runs longer than
 * the rest screen's 1-2 sentences and is not racing a countdown.
 */

import { AnthropicHttpError, AnthropicUnreachable } from './anthropicClient';
import { DraftValidationError } from './draftSchema';
import { createExerciseQuestionClient, EXERCISE_QUESTION_MAX_TOKENS } from './exerciseQuestionClient';

function textResponse(text: string) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    }),
  };
}

describe('createExerciseQuestionClient', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  it('posts the system and message to the Messages API with the key header', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Setup: grip the bar just outside shoulder width.'));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);
    await client.ask({ system: 'You are a coach', message: '## Exercise\n\nBench Press' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect(options.headers['x-api-key']).toBe('test-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.system).toBe('You are a coach');
    expect(body.messages).toEqual([
      { role: 'user', content: '## Exercise\n\nBench Press' },
    ]);
  });

  it('C1.3: uses configured model when provided (exercise question)', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('How to bench press.'));

    const client = createExerciseQuestionClient({ apiKey: 'test-key', model: 'claude-haiku' }, mockFetch);
    await client.ask({ system: 's', message: 'm' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-haiku');
  });

  it('budgets more tokens than the rest-screen comment — this is a detailed answer, not 1-2 sentences', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Brace hard.'));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);
    await client.ask({ system: 's', message: 'm' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(EXERCISE_QUESTION_MAX_TOKENS);
    expect(body.max_tokens).toBeGreaterThan(256);
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('asks for prose, not the structured turn schema', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Brace hard.'));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);
    await client.ask({ system: 's', message: 'm' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.output_config).toBeUndefined();
  });

  it('returns the raw answer text (normalization happens in the store)', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('  "Grip the bar,\n brace your core."  '));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);
    const answer = await client.ask({ system: 's', message: 'm' });

    expect(answer).toBe('  "Grip the bar,\n brace your core."  ');
  });

  it('skips a leading empty text block', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '' },
          { type: 'text', text: 'Keep your chest up throughout the movement.' },
        ],
      }),
    });

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).resolves.toBe(
      'Keep your chest up throughout the movement.'
    );
  });

  it('throws AnthropicUnreachable when the network fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      AnthropicUnreachable
    );
  });

  it('throws AnthropicHttpError with the status on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('unauthorized'),
    });

    const client = createExerciseQuestionClient({ apiKey: 'bad-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).rejects.toMatchObject({
      name: 'AnthropicHttpError',
      status: 401,
    });
  });

  it('throws DraftValidationError when the response carries no usable text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: [], stop_reason: 'max_tokens' }),
    });

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      DraftValidationError
    );
  });

  it('throws DraftValidationError when the only text block is blank', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('   '));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      DraftValidationError
    );
  });

  it('throws DraftValidationError when the response body is not valid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    });

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).rejects.toBeInstanceOf(
      DraftValidationError
    );
  });

  it('is a distinct error class hierarchy from a plain Error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const client = createExerciseQuestionClient({ apiKey: 'test-key' }, mockFetch);

    await expect(client.ask({ system: 's', message: 'm' })).rejects.not.toBeInstanceOf(
      AnthropicHttpError
    );
  });
});
