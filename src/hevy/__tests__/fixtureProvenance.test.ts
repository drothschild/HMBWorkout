/**
 * Regression guard for #323: no Hevy fixture may carry the wire field name
 * `supersets_id` (plural) ever again.
 *
 * `supersets_id` is not a typo risk — it is what Hevy's own published OpenAPI
 * *documentation* calls the field, and what the Hevy MCP connector's output
 * uses too (it normalizes toward the docs rather than the real response).
 * The real HTTP API sends `superset_id` (singular), confirmed by raw `curl`
 * against a live account on both the list and single-routine endpoints, for
 * two different routines. Every fixture in this directory must therefore be
 * captured or hand-built against the SINGULAR form; a future re-capture done
 * through a normalizing wrapper (the MCP connector, or any tool that follows
 * the docs instead of the wire) would silently reintroduce the exact bug
 * this issue fixed. This test makes that failure loud instead of silent.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const fixtureFiles = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'));

describe('Hevy fixtures — #323 regression guard', () => {
  it('has at least one fixture file to check (the guard is not vacuous)', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  it.each(fixtureFiles)('%s never contains the wire field name `supersets_id`', (name) => {
    const raw = readFileSync(join(FIXTURES_DIR, name), 'utf8');

    expect(raw).not.toContain('supersets_id');
  });
});
