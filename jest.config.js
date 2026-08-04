module.exports = {
  // Watchman's crawl hangs jest startup on this machine; use node's crawler.
  watchman: false,
  projects: [
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      // Note: state tests run here (pure TS Zustand store, no RN dependencies).
      // RN-specific tests will move to jest-expo rn project if needed in future phases.
      testMatch: ['<rootDir>/src/{engine,db,interop,state,sync,health,helpers,ai,theme}/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      collectCoverageFrom: ['src/{engine,db,interop}/**/*.ts', '!src/**/*.d.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
      transform: {
        '^.+\\.lv$': '<rootDir>/jest-lv-transform.js',
        '^.+\\.ts$': [
          'ts-jest',
          {
            tsconfig: {
              jsx: 'react-jsx',
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              experimentalDecorators: true,
              emitDecoratorMetadata: true,
              useDefineForClassFields: false,
            },
          },
        ],
      },
    },
    // rn project: anything touching RN modules or components
    // TODO: Phase 4 adds this when there are actual RN-environment tests
    // {
    //   displayName: 'rn',
    //   preset: 'jest-expo/ios',
    //   testMatch: ['<rootDir>/{app,components,state,sync,health}/**/*.test.ts?(x)'],
    // },
  ],
};
