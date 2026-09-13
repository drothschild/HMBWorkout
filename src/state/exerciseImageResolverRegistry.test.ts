import type { ExerciseImageResolver } from './exerciseImageResolver';

/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: each
   test must isolate the registry module so state does not leak between tests. */
describe('exerciseImageResolverRegistry', () => {
  describe('ensureExerciseImageResolver', () => {
    it('calls start once and returns the same resolver on subsequent calls', () => {
      jest.isolateModules(() => {
        const { ensureExerciseImageResolver: ensureResolver } = require('./exerciseImageResolverRegistry');
        const mockResolver: ExerciseImageResolver = {
          request: jest.fn(),
          stop: jest.fn(),
        };
        const start = jest.fn(() => mockResolver);

        const result1 = ensureResolver(start);
        const result2 = ensureResolver(() => {
          throw new Error('should not be called');
        });

        expect(result1).toBe(mockResolver);
        expect(result2).toBe(mockResolver);
        expect(start).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('requestExerciseImagePass', () => {
    it('before start, requestExerciseImagePass is a no-op', () => {
      jest.isolateModules(() => {
        const { requestExerciseImagePass } = require('./exerciseImageResolverRegistry');
        // Should not throw
        requestExerciseImagePass();
      });
    });

    it('after start, requestExerciseImagePass calls resolver.request', () => {
      jest.isolateModules(() => {
        const { ensureExerciseImageResolver, requestExerciseImagePass } = require('./exerciseImageResolverRegistry');
        const mockResolver: ExerciseImageResolver = {
          request: jest.fn(),
          stop: jest.fn(),
        };
        const start = jest.fn(() => mockResolver);

        ensureExerciseImageResolver(start);
        requestExerciseImagePass();

        expect(mockResolver.request).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('refreshExerciseImage', () => {
    it('returns unavailable before the resolver has started', async () => {
      await new Promise<void>((resolve, reject) => {
        jest.isolateModules(() => {
          const registry = require('./exerciseImageResolverRegistry') as {
            refreshExerciseImage?: (exerciseId: string) => Promise<unknown>;
          };
          const refresh = registry.refreshExerciseImage;
          (refresh ? refresh('bench-press') : Promise.resolve({ kind: 'not-implemented' }))
            .then((result) => {
              expect(result).toEqual({ kind: 'unavailable' });
              resolve();
            })
            .catch(reject);
        });
      });
    });

    it('forwards an explicit refresh to the one active resolver', async () => {
      await new Promise<void>((resolve, reject) => {
        jest.isolateModules(() => {
          const { ensureExerciseImageResolver, refreshExerciseImage } = require('./exerciseImageResolverRegistry') as {
            ensureExerciseImageResolver: (start: () => ExerciseImageResolver) => ExerciseImageResolver;
            refreshExerciseImage?: (exerciseId: string) => Promise<unknown>;
          };
          const refresh = jest.fn().mockResolvedValue({ kind: 'updated' });
          const mockResolver = {
            request: jest.fn(),
            refresh,
            stop: jest.fn(),
          } as unknown as ExerciseImageResolver;

          ensureExerciseImageResolver(() => mockResolver);
          (refreshExerciseImage ? refreshExerciseImage('bench-press') : Promise.resolve({ kind: 'not-implemented' }))
            .then((result) => {
              expect(result).toEqual({ kind: 'updated' });
              expect(refresh).toHaveBeenCalledWith('bench-press');
              resolve();
            })
            .catch(reject);
        });
      });
    });
  });
});
