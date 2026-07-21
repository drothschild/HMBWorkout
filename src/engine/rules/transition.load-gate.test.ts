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
  test('real checkRuleSource with resolver accepts types.lv, helpers.lv, transition.lv', () => {
    // Create resolver that returns the actual module files
    const resolver = (modulePath: string): string => {
      console.log(`Resolving module: ${modulePath}`);
      if (modulePath === 'types') {
        console.log('Returning types.lv');
        return typesSource;
      } else if (modulePath === 'helpers') {
        console.log('Returning helpers.lv');
        return helpersSource;
      }
      throw new Error(`Module not found: ${modulePath}`);
    };

    // Check transition.lv (the entry point with rule header)
    console.log('Checking transition.lv...');
    const result = checkRuleSource(transitionSource, { resolve: resolver });

    if (!result.ok) {
      console.error('Load gate failed');
      console.error('Errors:', result.errors);
    } else {
      console.log('Load gate passed!');
    }

    expect(result.ok).toBe(true);
  });

  test('helpers.lv parses as a module (no rule headers)', () => {
    // Helpers should NOT have any rule declarations at top level
    const lines = helpersSource.split('\n');
    const ruleCount = lines.filter(line => line.match(/^\s*rule\s+\w+/)).length;
    expect(ruleCount).toBe(0);

    // Should have let bindings for functions
    expect(helpersSource).toContain('let phase_to_string = fn');
    expect(helpersSource).toContain('let validate_set = fn');
    expect(helpersSource).toContain('let rest_duration = fn');

    // Should end with trailing expression
    expect(helpersSource.trim()).toMatch(/\n0\s*$/);
  });

  test('types.lv parses as a module (no rule headers)', () => {
    // Types should NOT have any rule declarations
    const lines = typesSource.split('\n');
    const ruleCount = lines.filter(line => line.match(/^\s*rule\s+\w+/)).length;
    expect(ruleCount).toBe(0);

    // Should have type definitions
    expect(typesSource).toContain('type Phase =');
    expect(typesSource).toContain('type Event =');

    // Should end with trailing expression
    expect(typesSource.trim()).toMatch(/\n(true|false|\d+)\s*$/);
  });

  test('transition.lv is the only file with a rule header', () => {
    // Count rule headers in each file
    const transitionRuleCount = transitionSource.split('\n').filter(line => line.match(/^\s*rule\s+\w+/)).length;
    const helpersRuleCount = helpersSource.split('\n').filter(line => line.match(/^\s*rule\s+\w+/)).length;
    const typesRuleCount = typesSource.split('\n').filter(line => line.match(/^\s*rule\s+\w+/)).length;

    expect(transitionRuleCount).toBeGreaterThan(0);
    expect(helpersRuleCount).toBe(0);
    expect(typesRuleCount).toBe(0);

    // transition should have exactly one rule (the main transition rule)
    expect(transitionRuleCount).toBe(1);
  });
});
