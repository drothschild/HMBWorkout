/**
 * Load-gate test for rules: verifies that types.lv, helpers.lv, transition.lv
 * compile successfully via checkRuleSource with an in-memory resolver.
 */

import { checkRuleSource } from 'rill-lang';
import * as fs from 'fs';
import * as path from 'path';

// Read the .lv source files
const rulesDir = __dirname;
const typesSource = fs.readFileSync(path.join(rulesDir, 'types.lv'), 'utf-8');
const helpersSource = fs.readFileSync(path.join(rulesDir, 'helpers.lv'), 'utf-8');
const transitionSource = fs.readFileSync(path.join(rulesDir, 'transition.lv'), 'utf-8');

describe('Rules load gate', () => {
  test('transition.lv compiles with resolver', () => {
    // Create in-memory resolver for module imports
    const sources: Record<string, string> = {
      types: typesSource,
      helpers: helpersSource,
      transition: transitionSource,
    };

    const resolve = (modulePath: string): string => {
      if (modulePath in sources) {
        return sources[modulePath];
      }
      throw new Error(`Module not found: ${modulePath}`);
    };

    // Check the transition rule (entry point)
    const result = checkRuleSource(transitionSource, { resolve });

    // Verify successful compilation
    expect(result).toHaveProperty('ok');
    if (!result.ok) {
      console.error('Compilation failed:', JSON.stringify(result, null, 2));
    }
    expect(result.ok).toBe(true);

    // Additional validation: result should have rule metadata
    if (result.ok) {
      expect(result).toHaveProperty('rules');
    }
  });

  test('helpers.lv compiles with resolver', () => {
    const sources: Record<string, string> = {
      types: typesSource,
      helpers: helpersSource,
    };

    const resolve = (modulePath: string): string => {
      if (modulePath in sources) {
        return sources[modulePath];
      }
      throw new Error(`Module not found: ${modulePath}`);
    };

    const result = checkRuleSource(helpersSource, { resolve });

    expect(result).toHaveProperty('ok');
    expect(result.ok).toBe(true);
  });

  test('types.lv compiles', () => {
    const result = checkRuleSource(typesSource, { resolve: () => '' });

    expect(result).toHaveProperty('ok');
    if (!result.ok) {
      console.error('Types compilation failed:', JSON.stringify(result, null, 2));
    }
    expect(result.ok).toBe(true);
  });
});
