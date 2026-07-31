import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { createAdapter } from './adapter';
import { migrations } from './migrations';

// jest.mock is hoisted above the imports, so the static SQLiteAdapter import
// receives the mocked default and no live JSI handle is ever created.
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
    createAdapter();
    expect(jest.mocked(SQLiteAdapter).mock.calls[0][0].migrations).toBe(migrations);
  });
});
