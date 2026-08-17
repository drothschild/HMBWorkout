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

describe('SQLite adapter factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pins what the native adapter passes as migrations: whatever migrationsForAdapter decides', () => {
    // This used to assert reference identity with `migrations`, to block silent
    // wipes on upgrade. At schema v6 the wipe is the intent (#276), so the pin
    // moves to the gate rather than being deleted: the adapter must pass
    // exactly what migrationsForAdapter returns for the declared schema
    // version. Passing `migrations` itself here would make validateAdapter
    // throw "Missing migration" out of the SQLiteAdapter constructor in every
    // non-production build, crashing a Debug boot before the reset can run.
    createAdapter();
    expect(jest.mocked(SQLiteAdapter).mock.calls[0][0].migrations).toBe(
      migrationsForAdapter(databaseSchema.version, migrations)
    );
    expect(jest.mocked(SQLiteAdapter).mock.calls[0][0].migrations).toBeUndefined();
  });
});
