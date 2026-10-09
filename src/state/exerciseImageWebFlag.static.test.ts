/**
 * #397 structural gates. `src/app` has no jest coverage, so the exercise
 * screen is read as text (precedent: src/domain/supersetGrouping.callSites.test.ts).
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');
const screen = fs.readFileSync(path.join(root, 'src/app/exercise/[id].tsx'), 'utf-8');
const doc = fs.readFileSync(path.join(root, 'docs/project-context/exercise-images.md'), 'utf-8');

describe('exercise screen web image search control (#397)', () => {
  it('reads the screen source (guards against a vacuous pass)', () => {
    expect(screen.length).toBeGreaterThan(500);
    expect(screen).toContain('accessibilityLabel="Search exercise images"');
  });

  it('imports the flag predicate', () => {
    expect(screen).toContain("from '@/state/buildFlags'");
    expect(screen).toContain('webImageFallbackEnabled');
  });

  it('wraps the Search exercise images control in the flag condition', () => {
    const guard = '{webImageSearchEnabled && (';
    const labelAt = screen.indexOf('accessibilityLabel="Search exercise images"');
    const guardAt = screen.lastIndexOf(guard, labelAt);
    expect(guardAt).toBeGreaterThan(-1);
    const between = screen.slice(guardAt + guard.length, labelAt);
    // Only the opening <Pressable ...> tag may sit between the guard and the label.
    expect(between).not.toContain(')}');
    expect(between.replace(/\s+/g, ' ').trim()).toBe('<Pressable accessibilityRole="button"');
  });

  it('derives the condition from the shared predicate', () => {
    expect(screen).toMatch(/const webImageSearchEnabled = webImageFallbackEnabled\(\)/);
  });
});

describe('exercise-images documentation (#397)', () => {
  it('documents the EXPO_PUBLIC_WEB_IMAGE_FALLBACK variable', () => {
    expect(doc).toContain('EXPO_PUBLIC_WEB_IMAGE_FALLBACK');
  });
});
