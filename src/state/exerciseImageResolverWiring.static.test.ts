/**
 * Static gate on `_layout.tsx` boot effect wiring (#335 AC2.10).
 *
 * The resolver must start on every launch (outside the `if (savedState)` block),
 * after `loadSettings()` (so the AI key is in the cache), and never awaited (so
 * it does not block boot). The structural checks below enforce placement; the
 * resolver's own tests verify behaviour.
 *
 * Reading the tree as text (rather than importing it) avoids importing
 * expo-file-system at test time — every test importing exerciseImageFiles is
 * forbidden. Inspired by sessionPrefillWiring.static.test.ts.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const LAYOUT = join(__dirname, '..', 'app', '_layout.tsx');

describe('_layout.tsx exercise image resolver wiring (#335 AC2.10)', () => {
  const source = () => readFileSync(LAYOUT, 'utf8');

  it('calls ensureExerciseImageResolver with the exact callback, immediately before setRulesLoaded(true)', () => {
    const text = source();
    // Strip comments (// and /* */) and whitespace to detect exact placement
    const stripped = text
      .replace(/\/\/.*$/gm, '') // remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
      .replace(/\s+/g, ''); // remove all whitespace

    // The exact sequence: call (possibly wrapped in try/catch) immediately followed by setRulesLoaded
    // Match: try{ensureExerciseImageResolver(()=>startExerciseImageResolver(createExerciseImageResolverDeps(database)));}catch...setRulesLoaded(true);
    const pattern = 'try\\{ensureExerciseImageResolver\\(\\(\\)=>startExerciseImageResolver\\(createExerciseImageResolverDeps\\(database\\)\\)\\);\\}catch\\([^)]*\\)\\{[^}]*\\}setRulesLoaded\\(true\\);';
    const matches = stripped.match(pattern);
    expect(matches).not.toBeNull();
    expect((matches || []).length).toBeGreaterThan(0);
  });

  it('call is NOT inside the if(savedState) block', () => {
    const text = source();
    // Extract the if (savedState) { ... } block
    const ifStart = text.indexOf('if (savedState)');
    if (ifStart === -1) throw new Error('if (savedState) marker not found');

    // Find the opening brace
    let braceCount = 0;
    let inBlock = false;
    let blockStart = -1;
    let blockEnd = -1;
    for (let i = ifStart; i < text.length; i++) {
      if (text[i] === '{') {
        if (!inBlock) blockStart = i;
        braceCount++;
        inBlock = true;
      } else if (text[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          blockEnd = i + 1;
          break;
        }
      }
    }
    if (blockStart === -1 || blockEnd === -1) throw new Error('Could not extract if(savedState) block');

    const ifBlock = text.substring(blockStart, blockEnd);
    expect(ifBlock).not.toContain('ensureExerciseImageResolver');
  });

  it('ordering: after loadSettings and rehydrateActiveSession, before setRulesLoaded(true)', () => {
    const text = source();
    const loadSettingsAt = text.indexOf('loadSettings(');
    const rehydrateAt = text.indexOf('rehydrateActiveSession(');
    const resolverAt = text.indexOf('ensureExerciseImageResolver(');
    const rulesLoadedAt = text.indexOf('setRulesLoaded(true)');

    expect(loadSettingsAt).toBeGreaterThanOrEqual(0);
    expect(rehydrateAt).toBeGreaterThanOrEqual(0);
    expect(resolverAt).toBeGreaterThanOrEqual(0);
    expect(rulesLoadedAt).toBeGreaterThanOrEqual(0);

    expect(loadSettingsAt).toBeLessThan(resolverAt);
    expect(rehydrateAt).toBeLessThan(resolverAt);
    expect(resolverAt).toBeLessThan(rulesLoadedAt);
  });

  it('is NOT awaited', () => {
    const text = source();
    expect(text).not.toMatch(/await\s+ensureExerciseImageResolver/);
  });

  it('no test file imports exerciseImageFiles', () => {
    const srcDir = join(__dirname, '..');
    const importPattern = /from\s+['"][^'"]*exerciseImageFiles['"]|require\(\s*['"][^'"]*exerciseImageFiles['"]\s*\)/;

    function walkDir(dir: string): void {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if ((entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) && fullPath !== __filename) {
          const content = readFileSync(fullPath, 'utf8');
          expect(content).not.toMatch(importPattern);
        }
      }
    }

    walkDir(srcDir);
  });
});
