import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { createAdapter as createWebAdapter } from './adapter.web';
import { migrationsForAdapter } from './adapterMigrations';

jest.mock('@nozbe/watermelondb/adapters/lokijs');

// See the long note in adapter.test.ts. Through v6 the gate returned
// `undefined`, so pinning the web adapter's wiring against the gate's real
// return value was an assertion with `undefined` on both sides — satisfied by
// hardcoding `migrations: undefined` or by dropping the key. The sentinel pins
// the wiring instead, and it is what caught the flip: at v7 the gate is a
// pass-through again, and a hardcoded `undefined` here would have wiped the
// user a second time with every declaration-level test still green.
// Nothing else in this file touches migrationsForAdapter; `./migrations` (the
// migrations object every other test here reads) is a different module and is
// deliberately NOT mocked.
jest.mock('./adapterMigrations', () => ({
  __esModule: true,
  migrationsForAdapter: jest.fn(() => 'SENTINEL'),
}));

describe('Database schema migrations', () => {
  it('has bumped the schema version to 8 for the per-set rest column', () => {
    expect(databaseSchema.version).toBe(8);
  });

  it('declares the routine_sets table with a per-set prescription on every column', () => {
    // AC1.1. A routine entry owns an ordered list of prescribed sets; each row
    // carries its own type, reps (or rep range), weight, duration and distance.
    // target_distance_m has no aggregate ancestor — it exists because Hevy
    // sends distance_meters and the column is free once a set table exists.
    expect(databaseSchema.tables['routine_sets'].columns).toEqual({
      routine_exercise_id: { name: 'routine_exercise_id', type: 'string', isIndexed: true },
      order: { name: 'order', type: 'number' },
      set_type: { name: 'set_type', type: 'string' },
      target_reps: { name: 'target_reps', type: 'number', isOptional: true },
      target_reps_max: { name: 'target_reps_max', type: 'number', isOptional: true },
      target_weight_kg: { name: 'target_weight_kg', type: 'number', isOptional: true },
      target_duration_seconds: {
        name: 'target_duration_seconds',
        type: 'number',
        isOptional: true,
      },
      target_distance_m: { name: 'target_distance_m', type: 'number', isOptional: true },
      // The per-set rest override (#281, schema v8). Nullable: null inherits
      // the entry-level rest_seconds, a value overrides it.
      rest_seconds: { name: 'rest_seconds', type: 'number', isOptional: true },
    });
  });

  it('undeclares every aggregate column on routine_exercises at v7', () => {
    // AC6.1. The contract step: `routine_sets` is the only place a plan lives.
    // UNDECLARED, not dropped — WatermelonDB 0.28 ships no `destroyColumn`, so
    // the physical columns stay in the SQLite file and the adapters ignore them
    // on read and write. That is v4's `sessions.sync_status` precedent, and it
    // is also why Phase 6 is revertable: the derived values Phases 1–5 wrote
    // are still on disk if a v8 ever re-declares them.
    for (const column of [
      'warmup_sets',
      'target_sets',
      'target_reps',
      'target_duration_seconds',
      'target_weight_kg',
    ]) {
      expect(databaseSchema.tables['routine_exercises'].columns[column]).toBeUndefined();
    }
  });

  it('keeps the routine_exercises columns that are not aggregates', () => {
    // The complement of the assertion above, so "undeclare the aggregates"
    // cannot be satisfied by deleting the table's columns wholesale — a
    // for-loop of `toBeUndefined` is silent about over-deletion.
    expect(Object.keys(databaseSchema.tables['routine_exercises'].columns).sort()).toEqual([
      'exercise_id',
      'notes',
      'order',
      'rest_seconds',
      'routine_id',
      'superset_group',
    ]);
  });

  it('declares exercises.description as an optional string column in the current schema', () => {
    expect(databaseSchema.tables['exercises'].columns['description']).toEqual({
      name: 'description',
      type: 'string',
      isOptional: true,
    });
  });

  it('declares session_sets.exercise_id as an optional indexed string column', () => {
    // Optional because every row written before v3 has no recorded identity —
    // those fall back to the routine_exercises join. Indexed because
    // getExerciseWorkingSetHistory now queries it directly.
    expect(databaseSchema.tables['session_sets'].columns['exercise_id']).toEqual({
      name: 'exercise_id',
      type: 'string',
      isOptional: true,
      isIndexed: true,
    });
  });

  it('declares routine_sets.target_weight_kg as an optional number column', () => {
    // The per-set successor to the entry-level column v7 undeclares. Optional
    // and nullable: an absent prescription leaves the SetLogger's
    // history-derived prefill unchanged.
    expect(databaseSchema.tables['routine_sets'].columns['target_weight_kg']).toEqual({
      name: 'target_weight_kg',
      type: 'number',
      isOptional: true,
    });
  });

  it('is a validated SchemaMigrations object', () => {
    expect(migrations.validated).toBe(true);
  });

  it('declares routine_sets.rest_seconds as an optional number column', () => {
    // The per-set rest override (#281). Nullable and non-backfilled: an absent
    // value leaves the engine reading the entry-level rest, exactly as every
    // routine authored before v8 does.
    expect(databaseSchema.tables['routine_sets'].columns['rest_seconds']).toEqual({
      name: 'rest_seconds',
      type: 'number',
      isOptional: true,
    });
  });

  it('covers the schema exactly, so no install is reset on the way to v8', () => {
    // AC1.7, INVERTED at Phase 6 and rewritten rather than deleted.
    //
    // Through v6 the omission WAS the mechanism: the schema outran the
    // migrations, `stepsForMigration` returned null past `maxVersion`, and both
    // adapters dropped and recreated the database. That wipe was deliberate and
    // it has already happened — a per-set list cannot be back-filled from the
    // count `3`, which says nothing about the ramp 9.07 → 11.34 → 18.14 kg.
    //
    // It must happen exactly once. Every install in the field is now on v6, so
    // withholding the migrations again at v7 would destroy whatever the user
    // rebuilt afterwards. Coverage and schema must agree from here on, and the
    // equality — not merely `>=` — is what `migrationsForAdapter` gates on.
    expect(migrations.maxVersion).toBe(8);
    expect(migrations.maxVersion).toBe(databaseSchema.version);
    expect(migrations.minVersion).toBe(1);
  });

  it('returns real steps for every upgrade path into v8, from every version an install can hold', () => {
    // The mirror of the loop this replaces, over the same domain: null was the
    // signal both adapters branch on to RESET, so a null anywhere in this range
    // is a silent wipe of a real user's database. v6 and v7 are the ones that
    // matter — every install in the field is on one of them — but a gap at any
    // starting version would show up here, and a gap is also what
    // `schemaMigrations` refuses at module init.
    for (let fromVersion = 1; fromVersion <= 7; fromVersion += 1) {
      expect(
        stepsForMigration({ migrations, fromVersion, toVersion: databaseSchema.version })
      ).not.toBeNull();
    }
  });

  it('walks a v1 install to v6 through four steps, where it used to return null', () => {
    // AC6.1 names this pin specifically as the one that inverts, and it gets
    // the number wrong: it says `stepsForMigration(1 → 6)` "returns 5 steps
    // rather than null". Measured, it returns FOUR.
    //
    // The discrepancy is entries versus steps. Five migration ENTRIES are
    // traversed (v2, v3, v4, v5, v6) but `stepsForMigration` concatenates their
    // `steps` arrays, and v4's is deliberately empty — sync_status was
    // undeclared, not dropped. Four steps out of five entries, and the same
    // arithmetic will apply to v7, whose steps array is empty for the same
    // reason.
    const steps = stepsForMigration({ migrations, fromVersion: 1, toVersion: 6 }) as {
      type: string;
      table?: string;
      schema?: { name: string };
    }[];

    expect(steps).toHaveLength(4);
    expect(steps.map((step) => `${step.type}:${step.table ?? step.schema?.name ?? ''}`)).toEqual([
      'add_columns:exercises',
      'add_columns:session_sets',
      'add_columns:routine_exercises',
      'create_table:routine_sets',
    ]);
  });

  it('adds nothing further between v6 and v7, so the full v1 walk is the same four steps', () => {
    // The other half of the entries-versus-steps point above, and a real
    // property rather than a restatement: v7 undeclares columns, and an
    // undeclaration has no step. A v1 install therefore runs exactly what a v1
    // install running to v6 runs.
    expect(stepsForMigration({ migrations, fromVersion: 1, toVersion: 7 })).toEqual(
      stepsForMigration({ migrations, fromVersion: 1, toVersion: 6 })
    );
  });

  it('adds routine_sets with a real createTable at v6, not an empty steps array', () => {
    // AC6.1. The v6 entry is gap-filler for every install that exists in
    // practice — they are all already on v6 and run only the 6 → 7 step — but
    // `steps: []` here would leave a v5-direct-to-v7 install with a schema
    // declaring a table its database does not have, which is a crash on first
    // query rather than a wipe. Executed end to end in migrationV6ToV7.test.ts.
    const steps = stepsForMigration({ migrations, fromVersion: 5, toVersion: 6 }) as {
      type: string;
      schema: { name: string; columns: Record<string, unknown> };
    }[];

    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('create_table');

    // The v6 shape, frozen. This literal must NOT be edited to chase a later
    // schema change: the entry describes the table as it existed at v6, and
    // anyone still upgrading through it gets what v6 had.
    expect(steps[0].schema.columns).toEqual({
      routine_exercise_id: { name: 'routine_exercise_id', type: 'string', isIndexed: true },
      order: { name: 'order', type: 'number' },
      set_type: { name: 'set_type', type: 'string' },
      target_reps: { name: 'target_reps', type: 'number', isOptional: true },
      target_reps_max: { name: 'target_reps_max', type: 'number', isOptional: true },
      target_weight_kg: { name: 'target_weight_kg', type: 'number', isOptional: true },
      target_duration_seconds: { name: 'target_duration_seconds', type: 'number', isOptional: true },
      target_distance_m: { name: 'target_distance_m', type: 'number', isOptional: true },
    });

    // …and the drift alarm, which is a different assertion with a different
    // remedy. A migration that leaves the table NARROWER than the schema
    // declares is the same class of bug as `steps: []`, one column down instead
    // of one table. When this goes red, the fix is a NEW migration entry for
    // the column that was added — never an edit to the frozen literal above.
    //
    // The v6 createTable is no longer the whole story: v8 adds
    // `rest_seconds` with its own addColumns entry (#281), so the alarm
    // reconstructs the table by folding EVERY step that touches routine_sets
    // across the full 1→8 walk and comparing THAT to the live schema. A column
    // added to schema.ts with no migration behind it fails to appear in the
    // reconstruction and reddens this — while the frozen v6 literal above stays
    // exactly as v6 shipped it.
    const reconstructed: Record<string, unknown> = {};
    for (const step of stepsForMigration({
      migrations,
      fromVersion: 1,
      toVersion: databaseSchema.version,
    }) as {
      type: string;
      table?: string;
      schema?: { name: string; columns: Record<string, unknown> };
      columns?: { name: string }[];
    }[]) {
      if (step.type === 'create_table' && step.schema?.name === 'routine_sets') {
        Object.assign(reconstructed, step.schema.columns);
      }
      if (step.type === 'add_columns' && step.table === 'routine_sets') {
        for (const column of step.columns ?? []) {
          reconstructed[column.name] = column;
        }
      }
    }
    expect(reconstructed).toEqual(databaseSchema.tables['routine_sets'].columns);
  });

  it('has an empty v6 to v7 migration, because the aggregates are undeclared rather than dropped', () => {
    // AC6.1, and the v4 precedent applied a second time: WatermelonDB 0.28
    // ships no column-removal step, so removing the five aggregate columns from
    // schema.ts IS the whole change and the entry exists only to keep the
    // version sequence gapless. `schemaMigrations` refuses a gapped list at
    // module init (Schema/migrations/index.js:82, NODE_ENV-gated), which is why
    // a lone toVersion: 7 is not an option.
    expect(stepsForMigration({ migrations, fromVersion: 6, toVersion: 7 })).toEqual([]);
  });

  it('a v6 install upgrades rather than resetting — the assertion the whole phase turns on', () => {
    // AC6.1's named regression, stated at the level the adapters branch on:
    // `[]` and `null` are both falsy and both "no steps to run", but the
    // adapters treat them oppositely — `[]` migrates, `null` calls
    // unsafeResetDatabase. A `toEqual([])` above passes under `null` for a
    // `toBeFalsy`-shaped mistake, so the non-null is asserted on its own.
    expect(stepsForMigration({ migrations, fromVersion: 6, toVersion: 7 })).not.toBeNull();
  });

  it('adds routine_sets.rest_seconds with a real addColumns step from v7 to v8', () => {
    // #281. Unlike the v4 and v7 undeclarations, and unlike #276's v6 wipe,
    // this is a NON-destructive migrating bump: one nullable column, a real
    // step, and every existing routine_sets row survives. A `steps: []` here —
    // copying v7's shape — would leave every upgrading install with a schema
    // declaring a column its database does not have. migrationV7ToV8.test.ts
    // drives a populated v7 database across the upgrade end to end.
    const steps = stepsForMigration({ migrations, fromVersion: 7, toVersion: 8 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('routine_sets');
    expect(step.columns).toEqual([{ name: 'rest_seconds', type: 'number', isOptional: true }]);
  });

  it('provides a migration step from version 1 to 2 that adds exercises.description', () => {
    const steps = stepsForMigration({ migrations, fromVersion: 1, toVersion: 2 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('exercises');
    expect(step.columns).toEqual([{ name: 'description', type: 'string', isOptional: true }]);
  });

  it('still walks a v1 install to v5 through the three addColumns steps', () => {
    // The original addColumns chain, unchanged by either bump. Asserting the
    // walk against the literal 5 rather than databaseSchema.version keeps this
    // test about the chain; the two later entries are asserted on their own.
    const steps = stepsForMigration({
      migrations,
      fromVersion: 1,
      toVersion: 5,
    }) as { table: string; columns: { name: string }[] }[];

    expect(steps.map((step) => `${step.table}.${step.columns[0].name}`)).toEqual([
      'exercises.description',
      'session_sets.exercise_id',
      'routine_exercises.target_weight_kg',
    ]);
  });

  it('provides a migration step from version 2 to 3 that adds session_sets.exercise_id', () => {
    const steps = stepsForMigration({ migrations, fromVersion: 2, toVersion: 3 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('session_sets');
    expect(step.columns).toEqual([
      { name: 'exercise_id', type: 'string', isOptional: true, isIndexed: true },
    ]);
  });

  it('has an empty v3 to v4 migration that adds no steps, because sync_status is undeclared rather than dropped', () => {
    // AC3.2: The v3→v4 migration returns an empty steps array. This is
    // deliberate: WatermelonDB 0.28 ships no column-removal step, and official
    // guidance is to leave the physical column in place and omit it from the
    // schema. The entry exists to keep the version sequence gapless.
    const steps = stepsForMigration({ migrations, fromVersion: 3, toVersion: 4 });
    expect(steps).toEqual([]);

    // AC3.6: The v3→v4 upgrade path does not throw. Note this test runs on
    // LokiJS via createTestDatabase(), so a real SQLite v3→v4 open is only
    // verified by the simulator pass in Task 7 (Phase 3).
  });

  it('provides a real migration step from v4 to v5 that adds routine_exercises.target_weight_kg', () => {
    // AC1.2: The v4→v5 migration uses a real addColumns step, unlike v4's
    // deliberately empty one. Copying v4's empty-steps shape here would leave
    // every upgrading install with a schema declaring a column its database
    // does not have.
    const steps = stepsForMigration({ migrations, fromVersion: 4, toVersion: 5 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('routine_exercises');
    expect(step.columns).toEqual([
      { name: 'target_weight_kg', type: 'number', isOptional: true },
    ]);
  });

  it('declares no sync_status column on the sessions table in the current schema', () => {
    // AC3.1: The undeclared sync_status must not appear in the schema.
    expect(databaseSchema.tables['sessions'].columns['sync_status']).toBeUndefined();
  });

  it('passes the web adapter whatever migrationsForAdapter decides, not a hardcoded value', () => {
    // This test used to assert reference identity with `migrations`, to block
    // silent wipes on upgrade. At v6 the wipe is the intent, so the pin moved
    // to the gate rather than being deleted — but it moved as
    // `toBe(migrationsForAdapter(...))` plus `toBeUndefined()`, which is
    // `undefined === undefined` and holds however the adapter is written.
    // The sentinel is what makes it a pin: Phase 6 flips this gate back to a
    // pass-through, and a hardcoded `undefined` here would swallow the flip
    // and wipe the user a second time.
    //
    // Mocking LokiJSAdapter prevents creating a live IndexedDB handle that would
    // hang the test; instead we verify what was passed as a constructor argument.
    createWebAdapter();
    expect(jest.mocked(LokiJSAdapter).mock.calls[0][0].migrations).toBe('SENTINEL');
    expect(migrationsForAdapter).toHaveBeenCalledWith(databaseSchema.version, migrations);
  });

  it('and today the real gate hands the web adapter the migrations themselves', () => {
    // The unmocked gate, so this file still records what actually reaches
    // LokiJSAdapter in this build — the sentinel above only proves the wiring.
    //
    // This flipped at Phase 6, and the flip is the whole safety property: while
    // the gate answered `undefined` a v6 user was wiped on every launch of a v7
    // build. It answers with the migrations because coverage and schema now
    // agree at 7.
    const { migrationsForAdapter: realGate } =
      jest.requireActual<typeof import('./adapterMigrations')>('./adapterMigrations');
    expect(realGate(databaseSchema.version, migrations)).toBe(migrations);
  });
});
