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
import transitionSource from './rules/transition.lv';

/**
 * Extract rule implementation body from a rule source (everything after the -> line).
 * Skips comments, rule header, and type declarations.
 */
function extractRuleBody(source: string): string {
  const lines = source.split('\n');
  let arrowLine = -1;
  // Find the line with ->
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('->')) {
      arrowLine = i;
      break;
    }
  }
  if (arrowLine === -1) throw new Error('No -> found in rule');
  // Body starts after -> line and first blank line
  let bodyStart = arrowLine + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') {
    bodyStart++;
  }
  return lines.slice(bodyStart).join('\n').trim();
}

/**
 * Build composite transition source with helpers inlined.
 * Wraps each helper's body as a let-binding so transition can call them.
 *
 * Format:
 * rule transition(...) -> ...
 *   let validate_set = fn(...) -> (\n  <body>\n)
 *   let rest_duration = fn(...) -> (\n  <body>\n)
 *   <transition body>
 */
function buildCompositeTransition(): string {
  const transitionLines = transitionSource.split('\n');

  // Find the rule line and arrow line
  let ruleLine = -1;
  let arrowLine = -1;
  for (let i = 0; i < transitionLines.length; i++) {
    if (transitionLines[i].trim().startsWith('rule transition')) {
      ruleLine = i;
    }
    if (transitionLines[i].includes('->') && ruleLine !== -1 && arrowLine === -1) {
      arrowLine = i;
      break;
    }
  }

  // Split transition into header (from rule keyword) + body (after ->)
  const headerLines = transitionLines.slice(ruleLine, arrowLine + 1);
  const bodyLines = transitionLines.slice(arrowLine + 1);

  // Extract helper bodies
  const validateSetBody = extractRuleBody(validateSetSource);
  const restDurationBody = extractRuleBody(restDurationSource);

  // Build composite: header + let-bindings + body
  // Note: we use inline let bindings so validate_set and rest_duration are in scope
  const composite = [
    ...headerLines,
    '',
    'let validate_set = fn(set) -> (',
    '  ' + validateSetBody.split('\n').join('\n  '),
    ')',
    '',
    'let rest_duration = fn(currentEntry, nextEntry, isLastExercise) -> (',
    '  ' + restDurationBody.split('\n').join('\n  '),
    ')',
    '',
    ...bodyLines,
  ].join('\n');

  return composite;
}

/**
 * transitionCompositeSource: transition rule with validate_set and rest_duration helpers inlined.
 * This eliminates duplication while keeping each helper's logic in one place (their own .lv file).
 */
export const transitionCompositeSource = buildCompositeTransition();

/**
 * Type-check all bundled rules.
 * On failure, throw a loud RuleLoadError that app boot will catch.
 * This satisfies AC10.2: all rules pass checkRuleSource at boot and in CI.
 *
 * NOTE: This must NOT be called at module import time. It is called only from
 * _layout.tsx's boot effect, which allows the RuleErrorScreen to render if
 * a rule fails to load. Module-init calls would crash before the error screen
 * could display.
 */
export function loadRules(): void {
  // Check standalone helpers
  const helpers = [
    { name: 'validate_set', source: validateSetSource },
    { name: 'rest_duration', source: restDurationSource },
    { name: 'progression_hint', source: progressionHintSource },
  ];

  for (const helper of helpers) {
    const result = checkRuleSource(helper.source);
    if (!result.ok) {
      throw new RuleLoadError(helper.name, result.errors[0]);
    }
  }

  // Check composite transition (uses helpers inlined)
  const result = checkRuleSource(transitionCompositeSource);
  if (!result.ok) {
    throw new RuleLoadError('transition', result.errors[0]);
  }
}
