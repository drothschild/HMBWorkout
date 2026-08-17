import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { createAdapter } from './adapter';
import { migrations } from './migrations';
import { databaseSchema } from './schema';
import { migrationsForAdapter } from './adapterMigrations';

// jest.mock is hoisted above the imports, so the static SQLiteAdapter import
// receives the mocked default and no live JSI handle is ever created.
jest.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// The gate is mocked to a value nothing in the app can produce, and that is the
// entire point of this file.
//
// The real gate returns `undefined` at schema v6, so the previous version of
// this test — `toBe(migrationsForAdapter(databaseSchema.version, migrations))`
// followed by `toBeUndefined()` — had `undefined` on both sides and held for
// ANY implementation that yields `undefined`. Three mutants passed it:
// hardcoding `migrations: undefined`, dropping the `migrations` key entirely,
// and the same two on adapter.web.ts. All three are indistinguishable today and
// divergent at Phase 6, when the gate flips back to a pass-through — at which
// point this wiring is the only thing standing between a v6 user and a second
// wipe. A sentinel pins the wiring itself rather than today's value of it.
jest.mock('./adapterMigrations', () => ({
  __esModule: true,
  migrationsForAdapter: jest.fn(() => 'SENTINEL'),
}));

describe('SQLite adapter factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(migrationsForAdapter).mockReturnValue('SENTINEL' as never);
  });

  it('passes the native adapter whatever migrationsForAdapter decides, not a hardcoded value', () => {
    createAdapter();
    expect(jest.mocked(SQLiteAdapter).mock.calls[0][0].migrations).toBe('SENTINEL');
  });

  it('asks the gate about the declared schema version and the app’s real migrations', () => {
    // The arguments matter as much as the return: asking about the wrong
    // version would make the gate answer a question nobody is holding.
    createAdapter();
    expect(migrationsForAdapter).toHaveBeenCalledWith(databaseSchema.version, migrations);
  });

  it('and today that decision is `undefined`, because v6 is the destructive bump', () => {
    // The real gate, not the mock — the sentinel above proves the wiring but
    // says nothing about what actually reaches SQLiteAdapter in this build.
    // Passing `migrations` itself would make validateAdapter throw "Missing
    // migration" out of the constructor in every non-production build,
    // crashing a Debug boot before the reset can run.
    const { migrationsForAdapter: realGate } =
      jest.requireActual<typeof import('./adapterMigrations')>('./adapterMigrations');
    expect(realGate(databaseSchema.version, migrations)).toBeUndefined();
  });
});
