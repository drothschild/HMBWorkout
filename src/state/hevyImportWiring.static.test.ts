/**
 * Static gate on the Settings → Data screen's Hevy wiring (#267 Phase 3).
 *
 * `src/app` is invisible to every jest project (the node project's `testMatch`
 * is `*.test.ts` under a fixed domain list; a `.tsx` screen full of RN and
 * expo-router imports cannot load), so the screen's behaviour has no runtime
 * cover at all. Reading the tree as text is this repo's established answer —
 * `dataExportWiring.static.test.ts`, `sessionPrefillWiring.static.test.ts`,
 * `activeSession.callSites.test.ts` — and AGENTS.md names it the criterion of
 * last resort rather than an optional extra.
 *
 * **These assertions are written to be non-vacuous.** A gate that merely
 * checked `toContain('mapHevyRoutine')` would pass on an import line with no
 * call, so each one anchors on a real call site or a real ordering and throws
 * loudly when its anchor disappears. The two invariants worth the trouble:
 *
 * 1. **The lossiness summary reaches the user BEFORE the write.** That
 *    ordering is the design's whole answer to "we could not represent X", and
 *    it is the half of the override decision that makes demotion acceptable
 *    instead of silent. It is pinned structurally by splitting the flow across
 *    two handlers: the one that maps must contain NO `applyRoutineImport`, and
 *    the one that writes must read the routine the first one staged.
 * 2. **A refused mapping writes nothing** — the same guard AC2.5 put on the
 *    markdown path.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DATA_SCREEN = join(__dirname, '..', 'app', '(tabs)', 'settings', 'data.tsx');

const source = () => readFileSync(DATA_SCREEN, 'utf8');
const collapsed = () => source().replace(/\s+/g, '');

/**
 * The body of the named arrow-function handler, whitespace-collapsed.
 *
 * Throws when the handler is gone, so a rename fails this gate loudly instead
 * of letting every assertion about it pass on an empty string.
 */
function handlerBody(name: string): string {
  const text = collapsed();
  const start = text.indexOf(`const${name}=async`);
  if (start < 0) {
    throw new Error(`data.tsx no longer defines ${name}; re-anchor this gate`);
  }
  // Up to the next handler definition, or to the render return.
  const rest = text.slice(start + 1);
  const nextHandler = rest.search(/const\w+=async/);
  const end = nextHandler < 0 ? rest.length : nextHandler;
  return rest.slice(0, end);
}

describe('Settings → Data Hevy wiring (#267 Phase 3)', () => {
  it('calls into the pure modules and holds no mapping decision itself', () => {
    const text = source();
    expect(text).toContain("from '@/hevy/hevyClient'");
    expect(text).toContain("from '@/hevy/hevyRoutineMap'");
    expect(text).toContain("from '@/hevy/hevyImportOutcome'");
    expect(text).toContain("from '@/state/hevySettings'");
    // The DB half is Phase 2's, reused rather than reimplemented.
    expect(text).toContain("from '@/state/applyRoutineImport'");
  });

  it('stages the mapping WITHOUT writing — the handler that maps never calls applyRoutineImport', () => {
    const body = handlerBody('handleHevyRoutineSelected');

    // It must actually map...
    expect(body).toContain('mapHevyRoutine(');
    // ...and it must compute the summary the user reads before deciding.
    expect(body).toContain('hevyLossinessSummary(');
    // ...and it must NOT write. This is the assertion the whole gate exists
    // for: deleting the confirmation step and writing inline fails here.
    expect(body).not.toContain('applyRoutineImport(');
  });

  it('writes only from the confirm handler, and only what the map handler staged', () => {
    const body = handlerBody('handleConfirmHevyImport');

    expect(body).toContain('applyRoutineImport(database,');
    // The staged routine, not a freshly re-mapped one — re-mapping at confirm
    // time would mean the user approved a summary of something else.
    expect(body).toContain('pendingHevy');
    expect(body).not.toContain('mapHevyRoutine(');
  });

  it('guards the staging on the mapper verdict, so a refused routine never stages', () => {
    const body = handlerBody('handleHevyRoutineSelected');

    const mapAt = body.indexOf('mapped=mapHevyRoutine(');
    const guardAt = body.indexOf('if(!mapped.ok)');
    const stageAt = body.indexOf('setPendingHevy(');

    expect(mapAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(mapAt).toBeLessThan(guardAt);
    expect(guardAt).toBeLessThan(stageAt);
    // The guard must return, not merely branch past one statement.
    expect(body.slice(guardAt, stageAt)).toContain('return');
  });

  it('renders the staged lossiness summary in the confirmation, not just in state', () => {
    const text = collapsed();
    // The summary must reach the JSX. Held in state and never rendered is the
    // exact failure this gate is here to catch.
    expect(text).toContain('{pendingHevy.summary}');
  });

  it('routes the key through hevyApiKeyPatch, never a bare hevyApiKey literal', () => {
    const text = collapsed();
    expect(text).toContain('queueSave(hevyApiKeyPatch(');
    // A hand-rolled patch would skip the trim, which is the one thing the
    // patch builder exists to do.
    expect(text).not.toMatch(/queueSave\(\{hevyApiKey:/);
  });

  it('routes every Hevy banner through the pure presenter', () => {
    const text = collapsed();
    for (const arm of ["kind:'no-key'", "kind:'unreachable'", "kind:'http-error'", "kind:'refused'", "kind:'imported'"]) {
      expect(text).toContain(`hevyImportOutcome({${arm}`);
    }
  });

  it('never builds a Hevy URL or names the header in CODE, so the key cannot reach one (AC3.9)', () => {
    // Comments are stripped first: this screen's own docstring says it does not
    // name the `api-key` header, and a gate that failed on the sentence
    // describing the rule would be measuring prose, not behaviour.
    const code = source()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toContain('api.hevyapp.com');
    expect(code).not.toContain('api-key');
    // The key is read once and handed straight to the client, never formatted
    // into anything.
    expect(code.replace(/\s+/g, '')).toContain('createHevyClient({apiKey:');
  });
});
