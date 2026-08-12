/**
 * OpenAI exercise-question one-shot client.
 *
 * Same conventions as `openaiClient.ts`: hand-rolled fetch POST to OpenAI
 * Responses API, no SDK, `fetchFn`-injectable for testing, network vs HTTP
 * error distinction. Asks for prose (not structured output).
 *
 * Callers are expected to swallow every error: logging a set must never
 * depend on the AI.
 */

import { DraftValidationError } from './draftSchema';
import { OpenaiUnreachable, OpenaiHttpError, OpenaiIncompleteError, OpenaiRefusalError } from './openaiClient';
import { buildOpenAiBody } from './provider/requestBuilder';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
// Use frontier tier for exercise questions — detailed how-to answers benefit from better reasoning
const MODEL = 'gpt-5.6-sol';

type FetchFn = typeof fetch;

export function createOpenaiExerciseQuestionClient(
  config: { apiKey: string },
  fetchFn?: FetchFn
) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    /** @returns the first non-empty text block, raw; callers normalize. */
    async ask(request: { system: string; message: string }): Promise<string> {
      const requestBody = buildOpenAiBody(
        {
          system: request.system,
          messages: [{ role: 'user', content: request.message }],
          surface: 'exerciseQuestion',
          outputFormat: 'text',
          // Dummy schema required by buildOpenAiBody, ignored when outputFormat is 'text'
          schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          schemaName: 'ExerciseQuestionResponse',
        },
        MODEL
      );

      let response: Response;
      try {
        response = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        throw new OpenaiUnreachable(
          error instanceof Error ? error.message : 'Network request failed'
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new OpenaiHttpError(response.status, `HTTP ${response.status}: ${text}`);
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new DraftValidationError('response body is not valid JSON');
      }

      if (responseBody === null || typeof responseBody !== 'object') {
        throw new DraftValidationError('response body is not a valid object');
      }

      // Check for top-level error
      const topLevelError = (responseBody as { error?: { message?: string } }).error;
      if (topLevelError?.message) {
        throw new DraftValidationError(`OpenAI error: ${topLevelError.message}`);
      }

      // Check for incomplete response
      const status = (responseBody as { status?: string }).status;
      if (status === 'incomplete') {
        const incompleteDetails = (responseBody as { incomplete_details?: { reason?: string } })
          .incomplete_details;
        const reason = incompleteDetails?.reason ?? 'unknown';
        throw new OpenaiIncompleteError(reason, `response incomplete: ${reason}`);
      }

      // OpenAI Responses format: output is an array of items, find the message item
      const output = (
        responseBody as {
          output?: { type?: string; content?: { type?: string; text?: string }[] }[];
        }
      ).output;

      if (!Array.isArray(output)) {
        throw new DraftValidationError('response output is not an array');
      }

      // Find the message item in output (reasoning items may precede it)
      const messageItem = output.find(
        (item): item is { type: string; content: { type?: string; text?: string }[] } =>
          item?.type === 'message' && Array.isArray(item?.content)
      );

      if (!messageItem) {
        throw new DraftValidationError('response output contains no message item');
      }

      // Part type is `output_text`, NOT `text`
      const textBlock = messageItem.content.find(
        (block): block is { type: string; text: string } =>
          block?.type === 'output_text' &&
          typeof block.text === 'string' &&
          block.text.trim().length > 0
      );

      const refusal = messageItem.content.find(
        (block): block is { type: string; refusal: string } =>
          (block as { type?: string }).type === 'refusal' &&
          typeof (block as { refusal?: unknown }).refusal === 'string'
      );
      if (refusal) {
        throw new OpenaiRefusalError(refusal.refusal);
      }

      if (!textBlock) {
        throw new DraftValidationError('response contains no usable question text');
      }

      return textBlock.text;
    },
  };
}

export type OpenaiExerciseQuestionClient = ReturnType<typeof createOpenaiExerciseQuestionClient>;
