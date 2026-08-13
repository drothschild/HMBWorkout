/**
 * OpenAI exercise-alternates one-shot client.
 *
 * Same conventions as `openaiClient.ts`: hand-rolled fetch POST to OpenAI
 * Responses API, no SDK, `fetchFn`-injectable for testing, network vs HTTP
 * error distinction. Asks for structured JSON (ExerciseAlternates).
 *
 * Callers are expected to swallow every error: a workout must never depend on
 * this call succeeding.
 */

import { DraftValidationError } from './draftSchema';
import {
  OpenaiUnreachable,
  OpenaiHttpError,
  OpenaiIncompleteError,
  OpenaiRefusalError,
  OpenaiSchemaError,
} from './openaiClient';
import {
  ALTERNATES_SCHEMA,
  ExerciseAlternates,
  parseExerciseAlternates,
} from './alternatesSchema';
import { buildOpenAiBody } from './provider/requestBuilder';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
// Use frontier tier for exercise suggestions — coaching decisions benefit from better reasoning
const MODEL = 'gpt-5.6-sol';

type FetchFn = typeof fetch;

export function createOpenaiAlternatesClient(
  config: { apiKey: string; model?: string },
  fetchFn?: FetchFn
) {
  const fetch = fetchFn ?? globalThis.fetch;
  const model = config.model ?? MODEL;

  return {
    /** @returns alternates already validated against `ALTERNATES_SCHEMA`'s bounds. */
    async suggest(request: { system: string; message: string }): Promise<ExerciseAlternates> {
      let body: Record<string, unknown>;
      try {
        body = buildOpenAiBody(
          {
            system: request.system,
            messages: [{ role: 'user', content: request.message }],
            schema: ALTERNATES_SCHEMA,
            schemaName: 'ExerciseAlternates',
            surface: 'alternates',
          },
          model
        );
      } catch (error) {
        throw new OpenaiSchemaError(
          error instanceof Error ? error.message : 'Failed to build OpenAI alternates request body'
        );
      }

      let response: Response;
      try {
        response = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
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

      // Check for incomplete response (critical for alternates — this is a list)
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
      const textBlocks = messageItem.content.filter(
        (block): block is { type: string; text: string } =>
          block?.type === 'output_text' && typeof block.text === 'string'
      );

      const refusal = messageItem.content.find(
        (block): block is { type: string; refusal: string } =>
          (block as { type?: string }).type === 'refusal' &&
          typeof (block as { refusal?: unknown }).refusal === 'string'
      );
      if (refusal) {
        throw new OpenaiRefusalError(refusal.refusal);
      }

      const textBlock = textBlocks.find((block) => block.text.length > 0);

      if (!textBlock) {
        if (textBlocks.length > 0) {
          throw new DraftValidationError('text block is empty');
        }
        throw new DraftValidationError('response contains no text content block');
      }

      return parseExerciseAlternates(textBlock.text);
    },
  };
}

export type OpenaiAlternatesClient = ReturnType<typeof createOpenaiAlternatesClient>;
