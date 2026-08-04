/**
 * Map HTTP and network errors to provider-specific error types.
 * Both providers emit the same error taxonomy so callers don't need to know which provider failed.
 */

import {
  AiProvider,
  ProviderHttpError,
  ProviderUnreachable,
} from './types';

type HttpErrorInput =
  | Error
  | {
      status: number;
      body: string;
    };

/**
 * Map a network or HTTP error to provider-specific error types.
 * Network errors become ProviderUnreachable; HTTP errors become ProviderHttpError.
 *
 * @param provider - which provider the error came from
 * @param input - either an Error (network) or {status, body} (HTTP)
 * @returns ProviderUnreachable or ProviderHttpError
 */
export function mapHttpError(provider: AiProvider, input: HttpErrorInput): Error {
  if (input instanceof Error) {
    return new ProviderUnreachable(provider, input.message);
  }

  return new ProviderHttpError(provider, input.status, input.body);
}
