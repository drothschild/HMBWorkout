import { LoggedSet } from '@/engine/types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { lex, parseProgram, evaluate, createPrelude, checkRuleSource, rillToJs, Value, RuleHeader } from 'rill-lang';

// Cache for the progression hint rule header
let progressionHintHeader: RuleHeader | null | undefined;

// Value-directed JS → Rill conversion (matches bridge.ts pattern)
// Converts null/undefined to None tag (for Option types in records)
function jsToRill(value: unknown): Value {
  if (value === null || value === undefined) {
    // Represent null/undefined as None tag for Option types
    return { kind: 'Tag', tag: 'None', args: [] };
  }
  if (typeof value === 'boolean') {
    return { kind: 'Bool', value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { kind: 'Int', value }
      : { kind: 'Float', value };
  }
  if (typeof value === 'string') {
    return { kind: 'String', value };
  }
  if (Array.isArray(value)) {
    return { kind: 'List', elements: value.map(jsToRill) };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length >= 1 && (value as any).tag !== undefined && typeof (value as any).tag === 'string') {
      const tagValue = (value as any).tag;
      const payload = (value as any).value;
      if (payload === undefined) {
        return { kind: 'Tag', tag: tagValue, args: [] };
      } else {
        return { kind: 'Tag', tag: tagValue, args: [jsToRill(payload)] };
      }
    }

    const fields = new Map<string, Value>();
    for (const [k, v] of Object.entries(value)) {
      fields.set(k, jsToRill(v));
    }
    return { kind: 'Record', fields };
  }
  // Default to None for undefined cases
  return { kind: 'Tag', tag: 'None', args: [] };
}

// Convert LoggedSet array to Rill values with proper Option wrapping
function loggedSetsToRill(sets: LoggedSet[]): Value {
  const elements: Value[] = sets.map(set => {
    const fields = new Map<string, Value>();
    fields.set('exerciseId', { kind: 'String', value: set.exerciseId });
    fields.set('setType', { kind: 'String', value: set.setType });

    // Wrap numeric fields in Some/None
    fields.set('reps', set.reps != null
      ? { kind: 'Tag', tag: 'Some', args: [{ kind: 'Int', value: set.reps }] } as Value
      : { kind: 'Tag', tag: 'None', args: [] } as Value
    );

    fields.set('weightKg', set.weightKg != null
      ? { kind: 'Tag', tag: 'Some', args: [{ kind: 'Float', value: set.weightKg }] } as Value
      : { kind: 'Tag', tag: 'None', args: [] } as Value
    );

    fields.set('durationSeconds', set.durationSeconds != null
      ? { kind: 'Tag', tag: 'Some', args: [{ kind: 'Int', value: set.durationSeconds }] } as Value
      : { kind: 'Tag', tag: 'None', args: [] } as Value
    );

    fields.set('rpe', set.rpe != null
      ? { kind: 'Tag', tag: 'Some', args: [{ kind: 'Float', value: set.rpe }] } as Value
      : { kind: 'Tag', tag: 'None', args: [] } as Value
    );

    return { kind: 'Record', fields } as Value;
  });

  return { kind: 'List', elements };
}

/**
 * Compute progression hint for a strength exercise based on logged sets.
 * Evaluates the progression_hint Rill rule to compute the hint.
 */
export function computeProgressionHint(currentExerciseId: string, loggedSets: LoggedSet[], exerciseKind?: string): string | undefined {
  // Only compute for strength exercises
  if (exerciseKind !== 'strength') {
    return undefined;
  }

  try {
    const ruleFilePath = join(__dirname, '..', 'rill', 'progressionHint.lv');
    const source = readFileSync(ruleFilePath, 'utf-8');

    // Cache the rule header (checkRuleSource once at load time)
    if (progressionHintHeader === undefined) {
      const checkResult = checkRuleSource(source);
      progressionHintHeader = checkResult.header ?? null;
    }

    // Build environment with injected data
    const env = createPrelude();
    env.set('history', loggedSetsToRill(loggedSets));

    // Parse and evaluate
    const tokens = lex(source);
    const program = parseProgram(tokens);
    const result = evaluate(program.body, env);
    const hint = rillToJs(result);

    return hint as string;
  } catch (error) {
    console.error('Failed to evaluate progression_hint rule:', error);
    return undefined;
  }
}
