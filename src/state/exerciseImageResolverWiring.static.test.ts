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

import { readFileSync } from 'fs';
import { join } from 'path';
import { readdirSync } from 'fs';

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
    // Check that the resolver is called with the correct arguments
    expect(text).toContain('ensureExerciseImageResolver(() => startExerciseImageResolver(createExerciseImageResolverDeps(database)));');
  });

  it('is placed immediately before setRulesLoaded(true)', () => {
    const text = source();
    // Must be OUTSIDE the if (savedState) block. The correct placement is
    // after the closing brace of the if block and immediately before setRulesLoaded(true).
    const normalized = text.replace(/\s+/g, ' ');

    // After the closing brace of the if block, there should be the resolver call
    // immediately followed by setRulesLoaded(true)
    expect(normalized).toMatch(
      /}\s*\/\/\s*Exercise images.*ensureExerciseImageResolver.*setRulesLoaded\(true\);/s
    );
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
    const testDir = join(__dirname);
    const testFiles = readdirSync(testDir)
      .filter((file) => file.endsWith('.test.ts') || file.endsWith('.test.tsx'))
      .filter((file) => file !== __filename);

    const importPattern = /from\s+['"][^'"]*exerciseImageFiles['"]|require\(\s*['"][^'"]*exerciseImageFiles['"]\s*\)/;

    for (const file of testFiles) {
      const filePath = join(testDir, file);
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(importPattern);
    }
  });
});
