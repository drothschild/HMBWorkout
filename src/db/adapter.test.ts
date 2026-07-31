// Mock SQLiteAdapter before adapter.ts is loaded
jest.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('SQLite adapter factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pins that the native adapter carries the exact migrations object exported by migrations.ts', () => {
    // Asserts by reference identity: if migrations is deleted or replaced with
    // a different object, this test fails, blocking silent wipes on upgrade.
    // Mocking SQLiteAdapter prevents creating a live JSI handle that would
    // fail at test time; instead we verify the migrations object was passed as a constructor argument.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() necessary after jest.mock() to get mocked adapter
    const { createAdapter } = require('./adapter');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() necessary to re-import after mock setup for reference identity
    const { migrations } = require('./migrations');
    createAdapter();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() necessary after jest.mock() to get mocked adapter
    const SQLiteAdapter = jest.mocked(require('@nozbe/watermelondb/adapters/sqlite').default);
    expect(SQLiteAdapter.mock.calls[0][0].migrations).toBe(migrations);
  });
});
