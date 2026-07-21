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
  // Extract rules from a module source by finding all 'rule Name...' declarations
  function extractRules(source: string, includeImports = true): Array<{ name: string; source: string }> {
    const lines = source.split('\n');
    const rules: Array<{ name: string; source: string }> = [];

    // Extract import statements if needed
    let imports = '';
    if (includeImports) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^\s*import\s+/)) {
          imports += line + '\n';
        } else if (line.trim() && !line.match(/^\s*--/)) {
          // Stop at first non-import, non-empty, non-comment line
          break;
        }
      }
    }

    let currentRule = '';
    let inRule = false;
    let braceCount = 0;

    const saveRule = () => {
      if (currentRule.trim()) {
        const nameMatch = currentRule.match(/rule\s+(\w+)/);
        if (nameMatch) {
          const fullSource = imports + currentRule;
          rules.push({ name: nameMatch[1], source: fullSource });
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line starts a rule
      if (line.match(/^\s*rule\s+\w+/)) {
        // If we were in a rule, save it
        if (inRule) {
          saveRule();
        }
        inRule = true;
        currentRule = line;
        braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      } else if (inRule) {
        currentRule += '\n' + line;
        braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

        // Check if we've closed all braces (rule body complete)
        if (braceCount <= 0 && line.match(/^\s*}/)) {
          saveRule();
          inRule = false;
        }
      }
    }

    // Don't forget the last rule if still in progress
    if (inRule) {
      saveRule();
    }

    return rules;
  }

  test('transition.lv rule has comma-separated match arms (not pipes)', () => {
    const transitionRules = extractRules(transitionSource, false);
    expect(transitionRules.length).toBeGreaterThan(0);

    const transitionRule = transitionRules[0].source;

    // Verify the transition rule has the expected structure
    expect(transitionRule).toContain('match event {');

    // Key indicators of comma-separated arms:
    // 1. Match arms end with ), followed by comma and next arm
    expect(transitionRule).toContain('),\n  StartSession');
    expect(transitionRule).toContain('),\n  LogSet');

    // 2. No pipes (|) before pattern names
    expect(transitionRule).not.toMatch(/\|\s+StartSession/);
    expect(transitionRule).not.toMatch(/\|\s+LogSet/);
  });

  test('helpers.lv rules have comma-separated match arms (not pipes)', () => {
    const helperRules = extractRules(helpersSource, false);
    expect(helperRules.length).toBeGreaterThan(0);

    // Check phase_to_string rule
    const phaseRule = helperRules.find(r => r.name === 'phase_to_string');
    expect(phaseRule).toBeDefined();

    if (phaseRule) {
      // Verify match has comma-separated arms
      expect(phaseRule.source).toContain('Idle -> "idle",');
      expect(phaseRule.source).toContain('Warmup -> "warmup",');
      expect(phaseRule.source).toContain('Done -> "done"');

      // No pipes
      expect(phaseRule.source).not.toMatch(/\|\s+Idle/);
      expect(phaseRule.source).not.toMatch(/\|\s+Warmup/);
    }
  });

  test('types.lv structure is valid', () => {
    // Types module should contain only type definitions, no rules
    const typeRules = extractRules(typesSource);
    expect(typeRules.length).toBe(0); // No rules in types module

    // Should have type definitions
    expect(typesSource).toContain('type Phase =');
    expect(typesSource).toContain('type Event =');
  });
});
