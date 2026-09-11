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

  it('calls ensureExerciseImageResolver exactly once', () => {
    const text = source();
    const matches = text.match(/ensureExerciseImageResolver\s*\(/g);
    expect(matches).toHaveLength(1);
  });

  it('passes the correct callback to ensureExerciseImageResolver', () => {
    const text = source();
    // Check that the function is called with the correct callback structure
    expect(text).toContain('ensureExerciseImageResolver(() =>');
    expect(text).toContain('startExerciseImageResolver(createExerciseImageResolverDeps(database))');
  });

  it('is placed immediately before setRulesLoaded(true)', () => {
    const text = source();
    // Must be OUTSIDE the if (savedState) block. Check that the resolver
    // call comes after the if (savedState) block and before setRulesLoaded(true).
    expect(text).toContain('});');
    expect(text).toContain('ensureExerciseImageResolver(');
    expect(text).toContain('setRulesLoaded(true);');
    // Check ordering: rehydrateActiveSession should come before the resolver
    const rehydrateIndex = text.indexOf('rehydrateActiveSession(');
    const resolverIndex = text.indexOf('ensureExerciseImageResolver(');
    const rulesLoadedIndex = text.indexOf('setRulesLoaded(true)');
    expect(rehydrateIndex).toBeLessThan(resolverIndex);
    expect(resolverIndex).toBeLessThan(rulesLoadedIndex);
  });

  it('is NOT awaited', () => {
    const text = source();
    expect(text).not.toMatch(/await\s+ensureExerciseImageResolver/);
  });

  it('appears after loadSettings', () => {
    const text = source();
    const loadSettingsAt = text.indexOf('loadSettings(');
    const resolverAt = text.indexOf('ensureExerciseImageResolver(');
    expect(resolverAt).toBeGreaterThan(loadSettingsAt);
  });

  it('appears after rehydrateActiveSession', () => {
    const text = source();
    const rehydrateAt = text.indexOf('rehydrateActiveSession(');
    const resolverAt = text.indexOf('ensureExerciseImageResolver(');
    expect(resolverAt).toBeGreaterThan(rehydrateAt);
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
