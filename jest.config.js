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
      // `hevy` (#267 Phase 3) must stay on this list: a new src/ domain gets NO
      // coverage until it is named here, and the failure mode is a green run
      // that executed none of the new suite (AGENTS.md Testing gotchas).
      testMatch: ['<rootDir>/src/{engine,db,domain,interop,state,health,helpers,ai,hevy,theme,watch,components,export}/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      moduleNameMapper: {
        '\\.wav$': '<rootDir>/src/test-setup/wav-stub.js',
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      collectCoverageFrom: ['src/{engine,db,interop,watch}/**/*.ts', '!src/**/*.d.ts'],
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
