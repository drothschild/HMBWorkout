/**
 * Bridge HTTP client with typed fetch wrapper.
 * Attaches bearer token, handles network vs HTTP errors distinctly.
 */

export class BridgeUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeUnreachable';
  }
}

export class BridgeHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'BridgeHttpError';
  }
}

interface BridgeConfig {
  baseUrl: string;
  token: string;
}

interface RoutineInfo {
  id: string;
  updated: number;
  markdown: string;
}

interface HealthResponse {
  ok: boolean;
}

interface SessionPayload {
  id: string;
  markdown: string;
}

type FetchFn = typeof fetch;

/**
 * Create a bridge client with the given configuration.
 * Fetch is injectable for testing; defaults to global fetch.
 */
export function createBridgeClient(config: BridgeConfig, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  async function withErrorHandling<T>(
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BridgeHttpError || error instanceof BridgeUnreachable) {
        throw error;
      }
      // Network error
      throw new BridgeUnreachable(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function request<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BridgeHttpError(response.status, `HTTP ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    async getRoutines(): Promise<RoutineInfo[]> {
      return withErrorHandling(() =>
        request<RoutineInfo[]>(`${config.baseUrl}/routines`)
      );
    },

    async getRoutine(id: string): Promise<RoutineInfo> {
      return withErrorHandling(() =>
        request<RoutineInfo>(`${config.baseUrl}/routines/${id}`)
      );
    },

    async postSession(payload: SessionPayload): Promise<void> {
      return withErrorHandling(() =>
        request<void>(`${config.baseUrl}/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
      );
    },

    async health(): Promise<HealthResponse> {
      return withErrorHandling(() =>
        request<HealthResponse>(`${config.baseUrl}/health`)
      );
    },
  };
}

export type BridgeClient = ReturnType<typeof createBridgeClient>;
