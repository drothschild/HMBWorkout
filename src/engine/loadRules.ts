import { checkRuleSource } from 'rill-lang';

// Import rule sources via Jest .lv transformer
import typesSource from './rules/types.lv';
import helpersSource from './rules/helpers.lv';
import transitionSource from './rules/transition.lv';

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
 * Type-check the bundled rules via checkRuleSource.
 * On failure, throw a loud RuleLoadError that app boot will catch.
 *
 * NOTE: This must NOT be called at module import time. It is called only from
 * _layout.tsx's boot effect, which allows the RuleErrorScreen to render if
 * a rule fails to load. Module-init calls would crash before the error screen
 * could display.
 */
export function loadRules(): void {
  // Create resolver for types.lv, helpers.lv, transition.lv
  const resolver = (modulePath: string): string => {
    if (modulePath === 'types') {
      return typesSource;
    } else if (modulePath === 'helpers') {
      return helpersSource;
    } else if (modulePath === 'transition') {
      return transitionSource;
    }
    throw new Error(`Module not found: ${modulePath}`);
  };

  // Check the entry rule (transition.lv) with resolver
  const result = checkRuleSource(transitionSource, { resolve: resolver });
  if (!result.ok) {
    throw new RuleLoadError('transition', result.errors[0]);
  }
}
