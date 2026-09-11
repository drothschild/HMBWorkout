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
});
