/**
 * The read-only Hevy API client (#267 Phase 3).
 *
 * **No SDK, on purpose** — the same decision `src/ai/anthropicClient.ts`
 * records and for the same two reasons: the client must stay RN-bundle-safe,
 * and it must be `fetchFn`-injectable so it tests in the node jest project with
 * no network. This is a hand-rolled `fetch` and should stay one.
 *
 * ## The request contract, confirmed against the live spec
 *
 * Read from the published OpenAPI document (`api.hevyapp.com/docs`, 2026-08-19)
 * rather than guessed, because a wrong parameter name is a 400 rather than a
 * compile error:
 *
 * - `GET /v1/routines?page={n}&pageSize={n}` — **camelCase `pageSize`**, not
 *   `page_size`. `page` is 1-based and must be ≥ 1; `pageSize` is capped at 10,
 *   which is why `DEFAULT_PAGE_SIZE` is 10 rather than something rounder.
 * - `GET /v1/routines/{routineId}`.
 * - The key is a required **`api-key` request header** on both. The spec
 *   defines no `securityScheme` and no query-parameter alternative.
 * - The list response is `{ page, page_count, routines }`; the single-routine
 *   response is `{ routine }`. Both envelopes are unwrapped here so no caller
 *   has to know the wire shape.
 *
 * ## The key never leaves the header (AC3.9)
 *
 * It is not interpolated into a URL, not put in a body, and never included in
 * an error message — `HevyHttpError` carries the status and the response text,
 * both of which are Hevy's own output, and `HevyUnreachable` carries the thrown
 * cause's message. Nothing in this module logs. `__tests__/hevyClient.test.ts`
 * asserts the ABSENCE of the key from every URL, body, message and stack the
 * module produces, which is the shape `src/ai/contextBuilder.test.ts` uses for
 * the Anthropic key.
 */

import type { HevyRoutine, HevyRoutinePage } from './types';

const HEVY_BASE_URL = 'https://api.hevyapp.com';

/** The spec's documented maximum. Asking for more is a 400. */
const DEFAULT_PAGE_SIZE = 10;

type FetchFn = typeof fetch;

/** The request never reached Hevy: offline, DNS, TLS, a dropped socket. */
export class HevyUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HevyUnreachable';
  }
}

/**
 * Hevy answered, but not with a routine: a non-2xx status, a body that is not
 * JSON, or a 200 whose envelope is missing the field it promised.
 *
 * The last two are deliberately NOT `HevyUnreachable`. Retrying an unparseable
 * 200 is pointless in a way that retrying an offline request is not, and the
 * two exist as separate types precisely so a caller can tell them apart.
 */
export class HevyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HevyHttpError';
  }
}

export interface HevyClientConfig {
  apiKey: string;
}

export interface ListRoutinesRequest {
  /** 1-based, per the spec. */
  page: number;
  /** Capped at 10 by the API; defaults to that maximum. */
  pageSize?: number;
}

export function createHevyClient(config: HevyClientConfig, fetchFn?: FetchFn) {
  const doFetch = fetchFn ?? globalThis.fetch;
  // Trimmed once, here, at the wire — the same two-layer arrangement the AI
  // provider settings use, where the store also trims on the way in.
  const apiKey = config.apiKey.trim();

  async function getJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: {
          // The ONLY place the key appears. Never a query parameter.
          'api-key': apiKey,
          accept: 'application/json',
        },
      });
    } catch (error) {
      throw new HevyUnreachable(
        error instanceof Error ? error.message : 'Network request failed'
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HevyHttpError(response.status, `HTTP ${response.status}: ${text}`);
    }

    try {
      return await response.json();
    } catch {
      throw new HevyHttpError(response.status, 'Hevy returned a response that is not JSON.');
    }
  }

  return {
    /**
     * One page of routines. The list endpoint returns FULL routine objects,
     * exercises and sets included, so a caller that has listed a routine does
     * not need `getRoutine` to import it.
     */
    async listRoutines(request: ListRoutinesRequest): Promise<HevyRoutinePage> {
      const pageSize = request.pageSize ?? DEFAULT_PAGE_SIZE;
      const body = await getJson(
        `${HEVY_BASE_URL}/v1/routines?page=${encodeURIComponent(String(request.page))}` +
          `&pageSize=${encodeURIComponent(String(pageSize))}`
      );

      const envelope = body as { page?: number; page_count?: number; routines?: HevyRoutine[] };
      if (!Array.isArray(envelope?.routines)) {
        throw new HevyHttpError(200, 'Hevy returned no routine list.');
      }

      return {
        page: envelope.page ?? request.page,
        pageCount: envelope.page_count ?? 1,
        routines: envelope.routines,
      };
    },

    /** One routine by id. `routineId` is percent-encoded into the path. */
    async getRoutine(routineId: string): Promise<HevyRoutine> {
      const body = await getJson(
        `${HEVY_BASE_URL}/v1/routines/${encodeURIComponent(routineId)}`
      );

      const envelope = body as { routine?: HevyRoutine };
      if (!envelope?.routine || typeof envelope.routine !== 'object') {
        throw new HevyHttpError(200, 'Hevy returned no routine.');
      }

      return envelope.routine;
    },
  };
}

export type HevyClient = ReturnType<typeof createHevyClient>;
