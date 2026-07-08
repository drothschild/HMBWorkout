import { checkRuleSource } from 'rill-lang';

/**
 * RuleLoadError — thrown when a rule fails type-checking at module init.
 * Includes rule name and the type error message.
 */
export class RuleLoadError extends Error {
  constructor(ruleName: string, typeError: string) {
    super(`Rule '${ruleName}' failed type-checking: ${typeError}`);
    this.name = 'RuleLoadError';
  }
}

/**
 * Import every bundled .lv rule source.
 * These are imported as strings via babel-plugin-inline-import.
 */
import validateSetSource from './rules/validate_set.lv';
import restDurationSource from './rules/rest_duration.lv';
import progressionHintSource from './rules/progression_hint.lv';

/**
 * At module init, type-check all bundled rules.
 * On failure, throw a loud RuleLoadError that app boot will catch.
 * This satisfies AC10.2: all rules pass checkRuleSource at boot and in CI.
 */
export function loadRules(): void {
  const rules = [
    { name: 'validate_set', source: validateSetSource },
    { name: 'rest_duration', source: restDurationSource },
    { name: 'progression_hint', source: progressionHintSource },
  ];

  for (const rule of rules) {
    const result = checkRuleSource(rule.source);
    if (!result.ok) {
      throw new RuleLoadError(rule.name, result.errors[0]);
    }
  }
}

// Call at module init — this will fail the whole app at boot if any rule is broken.
loadRules();
