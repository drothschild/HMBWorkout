/**
 * `createHevyClient` — the read-only Hevy API client (#267 Phase 3, AC3.9).
 *
 * Mirrors `src/ai/anthropicClient.ts`: hand-rolled `fetch`, no SDK, injectable
 * `fetchFn`, and network failure (`HevyUnreachable`) kept distinct from HTTP
 * failure (`HevyHttpError`). **Nothing here ever calls the live API** — every
 * test drives an injected `fetchFn`.
 *
 * The load-bearing assertion is the key one: the API key travels in an
 * `api-key` HEADER and must never appear in a URL, a log line, an error
 * message, or anywhere else an exception could carry it. That regression test
 * is written the way `src/ai/contextBuilder.test.ts` writes its own — assert
 * the secret's ABSENCE from everything the module produces, not merely its
 * presence in the header.
 */

import {
  HevyHttpError,
  HevyUnreachable,
  createHevyClient,
} from '../hevyClient';

/** Not a real key. Distinctive enough that a substring search cannot miss it. */
const KEY = 'hevy-secret-key-1a2b3c4d-DO-NOT-LEAK';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * The error a call raised, as an `Error`. Fails loudly when the call RESOLVED —
 * a leak assertion that silently ran against a success value would pass for the
 * wrong reason, which is the one way an absence test can go quietly wrong.
 */
async function raised(call: () => Promise<unknown>): Promise<Error> {
  try {
    await call();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const ONE_ROUTINE = {
  id: 'routine-uuid',
  title: 'Push',
  exercises: [
    { title: 'Bench Press (Dumbbell)', index: 0, sets: [{ index: 0, type: 'normal', reps: 8 }] },
  ],
};

describe('createHevyClient — AC3.9 the key travels in a header, never in a URL', () => {
  it('sends the key as an `api-key` request header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ page: 1, page_count: 1, routines: [ONE_ROUTINE] });
    }) as unknown as typeof fetch;

    const client = createHevyClient({ apiKey: KEY }, fetchFn);
    await client.listRoutines({ page: 1 });

    expect(calls).toHaveLength(1);
    expect((calls[0].init?.headers as Record<string, string>)['api-key']).toBe(KEY);
  });

  it('puts the key in NO url and NO body, on either endpoint', async () => {
    const seen: string[] = [];
    const fetchFn = jest.fn(async (url: string, init?: RequestInit) => {
      seen.push(url);
      seen.push(String(init?.body ?? ''));
      return jsonResponse({ page: 1, page_count: 1, routines: [ONE_ROUTINE] });
    }) as unknown as typeof fetch;

    const client = createHevyClient({ apiKey: KEY }, fetchFn);
    await client.listRoutines({ page: 2, pageSize: 10 });

    for (const fragment of seen) {
      expect(fragment).not.toContain(KEY);
    }
  });

  it('keeps the key out of both error types, message and stack alike', async () => {
    const httpFetch = (async () =>
      ({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
        json: async () => ({}),
      }) as unknown as Response) as unknown as typeof fetch;

    const client = createHevyClient({ apiKey: KEY }, httpFetch);
    await expect(client.listRoutines({ page: 1 })).rejects.toBeInstanceOf(HevyHttpError);

    const httpError = await raised(() => client.listRoutines({ page: 1 }));
    expect(httpError).toBeInstanceOf(HevyHttpError);
    expect(String(httpError.message)).not.toContain(KEY);
    expect(String(httpError.stack ?? '')).not.toContain(KEY);

    // The same for the network arm, whose message is the thrown cause's.
    const throwingFetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.hevyapp.com');
    }) as unknown as typeof fetch;
    const offline = createHevyClient({ apiKey: KEY }, throwingFetch);
    const netError = await raised(() => offline.listRoutines({ page: 1 }));
    expect(netError).toBeInstanceOf(HevyUnreachable);
    expect(String(netError.message)).not.toContain(KEY);
    expect(String(netError.stack ?? '')).not.toContain(KEY);
  });
});

describe('createHevyClient — the request contract the live spec pins', () => {
  it('calls GET https://api.hevyapp.com/v1/routines with `page` and `pageSize`', async () => {
    let seenUrl = '';
    let seenMethod: string | undefined;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenMethod = init?.method;
      return jsonResponse({ page: 3, page_count: 4, routines: [] });
    }) as unknown as typeof fetch;

    const client = createHevyClient({ apiKey: KEY }, fetchFn);
    await client.listRoutines({ page: 3, pageSize: 10 });

    // camelCase `pageSize`, not `page_size`: confirmed against the published
    // OpenAPI document (GET /v1/routines), where a wrong name is a 400.
    expect(seenUrl).toBe('https://api.hevyapp.com/v1/routines?page=3&pageSize=10');
    expect(seenMethod).toBe('GET');
  });

  it('defaults to the spec’s maximum pageSize of 10', async () => {
    let seenUrl = '';
    const fetchFn = (async (url: string) => {
      seenUrl = url;
      return jsonResponse({ page: 1, page_count: 1, routines: [] });
    }) as unknown as typeof fetch;

    await createHevyClient({ apiKey: KEY }, fetchFn).listRoutines({ page: 1 });

    expect(seenUrl).toBe('https://api.hevyapp.com/v1/routines?page=1&pageSize=10');
  });

  it('unwraps the { page, page_count, routines } envelope', async () => {
    const fetchFn = (async () =>
      jsonResponse({ page: 2, page_count: 5, routines: [ONE_ROUTINE] })) as unknown as typeof fetch;

    const result = await createHevyClient({ apiKey: KEY }, fetchFn).listRoutines({ page: 2 });

    expect(result).toEqual({ page: 2, pageCount: 5, routines: [ONE_ROUTINE] });
  });

  it('fetches one routine by id and unwraps its { routine } envelope', async () => {
    let seenUrl = '';
    const fetchFn = (async (url: string) => {
      seenUrl = url;
      return jsonResponse({ routine: ONE_ROUTINE });
    }) as unknown as typeof fetch;

    const routine = await createHevyClient({ apiKey: KEY }, fetchFn).getRoutine('routine-uuid');

    expect(seenUrl).toBe('https://api.hevyapp.com/v1/routines/routine-uuid');
    expect(routine).toEqual(ONE_ROUTINE);
  });

  it('percent-encodes a routine id rather than pasting it into the path', async () => {
    let seenUrl = '';
    const fetchFn = (async (url: string) => {
      seenUrl = url;
      return jsonResponse({ routine: ONE_ROUTINE });
    }) as unknown as typeof fetch;

    await createHevyClient({ apiKey: KEY }, fetchFn).getRoutine('a b/c?d');

    expect(seenUrl).toBe('https://api.hevyapp.com/v1/routines/a%20b%2Fc%3Fd');
  });
});

describe('createHevyClient — network failure and HTTP failure are different types', () => {
  it('raises HevyUnreachable when fetch itself throws', async () => {
    const fetchFn = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await expect(
      createHevyClient({ apiKey: KEY }, fetchFn).listRoutines({ page: 1 })
    ).rejects.toBeInstanceOf(HevyUnreachable);
  });

  it('raises HevyHttpError carrying the status when the response is not ok', async () => {
    const fetchFn = (async () =>
      ({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
        json: async () => ({}),
      }) as unknown as Response) as unknown as typeof fetch;

    const error = await createHevyClient({ apiKey: KEY }, fetchFn)
      .listRoutines({ page: 1 })
      .catch((raised: unknown) => raised);

    expect(error).toBeInstanceOf(HevyHttpError);
    expect((error as HevyHttpError).status).toBe(429);
  });

  it('raises HevyHttpError, not HevyUnreachable, when the body is not JSON', async () => {
    const fetchFn = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
        text: async () => '<html>',
      }) as unknown as Response) as unknown as typeof fetch;

    await expect(
      createHevyClient({ apiKey: KEY }, fetchFn).listRoutines({ page: 1 })
    ).rejects.toBeInstanceOf(HevyHttpError);
  });

  it('raises HevyHttpError when the envelope has no routines array', async () => {
    const fetchFn = (async () => jsonResponse({ page: 1, page_count: 1 })) as unknown as typeof fetch;

    await expect(
      createHevyClient({ apiKey: KEY }, fetchFn).listRoutines({ page: 1 })
    ).rejects.toBeInstanceOf(HevyHttpError);
  });
});
