import { mapHttpError } from './errorMapper';
import {
  ProviderHttpError,
  ProviderUnreachable,
} from './types';

describe('errorMapper', () => {
  describe('mapHttpError', () => {
    it('maps network errors to ProviderUnreachable', () => {
      const networkError = new Error('Network timeout');
      const error = mapHttpError('anthropic', networkError);

      expect(error).toBeInstanceOf(ProviderUnreachable);
      expect((error as ProviderUnreachable).provider).toBe('anthropic');
      expect(error.message).toContain('unreachable');
    });

    it('maps HTTP status codes to ProviderHttpError', () => {
      const error = mapHttpError('anthropic', { status: 401, body: 'Invalid key' });

      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).provider).toBe('anthropic');
      expect((error as ProviderHttpError).status).toBe(401);
    });

    it('handles OpenAI errors', () => {
      const error = mapHttpError('openai', { status: 429, body: 'Rate limited' });

      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).provider).toBe('openai');
      expect((error as ProviderHttpError).status).toBe(429);
    });

    it('includes response body in error message', () => {
      const error = mapHttpError('anthropic', {
        status: 500,
        body: 'Internal server error',
      }) as ProviderHttpError;

      expect(error.message).toContain('Internal server error');
    });

    it('handles empty body gracefully', () => {
      const error = mapHttpError('anthropic', { status: 503, body: '' });

      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).status).toBe(503);
    });

    it('distinguishes network from HTTP errors', () => {
      const networkError = mapHttpError('anthropic', new Error('ENOTFOUND'));
      const httpError = mapHttpError('anthropic', { status: 500, body: 'Error' });

      expect(networkError).toBeInstanceOf(ProviderUnreachable);
      expect(httpError).toBeInstanceOf(ProviderHttpError);
    });
  });
});
