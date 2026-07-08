import { jsToRill, rillToJs, evaluateSource, RuleResult } from './bridge';
import { Value } from 'rill-lang';

describe('bridge: jsToRill / rillToJs / evaluateSource', () => {
  describe('jsToRill', () => {
    it('converts null to Unit', () => {
      const result = jsToRill(null);
      expect(result.kind).toBe('Unit');
    });

    it('converts undefined to Unit', () => {
      const result = jsToRill(undefined);
      expect(result.kind).toBe('Unit');
    });

    it('converts boolean true', () => {
      const result = jsToRill(true);
      expect(result.kind).toBe('Bool');
      expect((result as any).value).toBe(true);
    });

    it('converts boolean false', () => {
      const result = jsToRill(false);
      expect(result.kind).toBe('Bool');
      expect((result as any).value).toBe(false);
    });

    it('converts integer', () => {
      const result = jsToRill(42);
      expect(result.kind).toBe('Int');
      expect((result as any).value).toBe(42);
    });

    it('converts float', () => {
      const result = jsToRill(3.14);
      expect(result.kind).toBe('Float');
      expect((result as any).value).toBe(3.14);
    });

    it('converts string', () => {
      const result = jsToRill('hello');
      expect(result.kind).toBe('String');
      expect((result as any).value).toBe('hello');
    });

    it('converts array to List', () => {
      const result = jsToRill([1, 2, 3]);
      expect(result.kind).toBe('List');
      expect((result as any).elements).toHaveLength(3);
      expect(((result as any).elements[0] as Value).kind).toBe('Int');
    });

    it('converts nested array', () => {
      const result = jsToRill([1, [2, 3]]);
      expect(result.kind).toBe('List');
      expect((result as any).elements).toHaveLength(2);
      expect(((result as any).elements[1] as Value).kind).toBe('List');
    });

    it('converts object to Record', () => {
      const result = jsToRill({ name: 'Alice', age: 30 });
      expect(result.kind).toBe('Record');
      expect((result as any).fields.size).toBe(2);
      expect(((result as any).fields.get('name') as Value).kind).toBe('String');
      expect(((result as any).fields.get('age') as Value).kind).toBe('Int');
    });

    it('converts nested object', () => {
      const result = jsToRill({ outer: { inner: 42 } });
      expect(result.kind).toBe('Record');
      const innerValue = (result as any).fields.get('outer') as Value;
      expect(innerValue.kind).toBe('Record');
      expect(((innerValue as any).fields.get('inner') as Value).kind).toBe('Int');
    });
  });

  describe('rillToJs', () => {
    it('converts Unit to null', () => {
      const rillVal: Value = { kind: 'Unit' };
      const result = rillToJs(rillVal);
      expect(result).toBe(null);
    });

    it('converts Int', () => {
      const rillVal: Value = { kind: 'Int', value: 42 };
      const result = rillToJs(rillVal);
      expect(result).toBe(42);
    });

    it('converts Float', () => {
      const rillVal: Value = { kind: 'Float', value: 3.14 };
      const result = rillToJs(rillVal);
      expect(result).toBe(3.14);
    });

    it('converts String', () => {
      const rillVal: Value = { kind: 'String', value: 'hello' };
      const result = rillToJs(rillVal);
      expect(result).toBe('hello');
    });

    it('converts Bool', () => {
      const rillVal: Value = { kind: 'Bool', value: true };
      const result = rillToJs(rillVal);
      expect(result).toBe(true);
    });

    it('converts List', () => {
      const rillVal: Value = {
        kind: 'List',
        elements: [
          { kind: 'Int', value: 1 },
          { kind: 'Int', value: 2 },
        ],
      };
      const result = rillToJs(rillVal);
      expect(result).toEqual([1, 2]);
    });

    it('converts Record', () => {
      const fields = new Map<string, Value>();
      fields.set('name', { kind: 'String', value: 'Alice' });
      fields.set('age', { kind: 'Int', value: 30 });
      const rillVal: Value = { kind: 'Record', fields };
      const result = rillToJs(rillVal);
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('converts Tag with no args to string', () => {
      const rillVal: Value = { kind: 'Tag', tag: 'Ok', args: [] };
      const result = rillToJs(rillVal);
      expect(result).toBe('Ok');
    });

    it('converts Tag with one arg to object', () => {
      const rillVal: Value = {
        kind: 'Tag',
        tag: 'Ok',
        args: [{ kind: 'String', value: 'success' }],
      };
      const result = rillToJs(rillVal);
      expect(result).toEqual({ tag: 'Ok', value: 'success' });
    });

    it('converts Tag with multiple args to object with values array', () => {
      const rillVal: Value = {
        kind: 'Tag',
        tag: 'Err',
        args: [{ kind: 'String', value: 'error1' }, { kind: 'String', value: 'error2' }],
      };
      const result = rillToJs(rillVal);
      expect(result).toEqual({ tag: 'Err', values: ['error1', 'error2'] });
    });
  });

  describe('round-trip jsToRill → rillToJs', () => {
    it('preserves primitives', () => {
      const tests = [null, true, false, 42, 3.14, 'hello'];
      for (const val of tests) {
        const rillVal = jsToRill(val);
        const result = rillToJs(rillVal);
        expect(result).toEqual(val);
      }
    });

    it('preserves arrays of primitives', () => {
      const original = [1, 2.5, 'three', true, null];
      const rillVal = jsToRill(original);
      const result = rillToJs(rillVal);
      expect(result).toEqual(original);
    });

    it('preserves nested arrays', () => {
      const original = [[1, 2], [3, 4]];
      const rillVal = jsToRill(original);
      const result = rillToJs(rillVal);
      expect(result).toEqual(original);
    });

    it('preserves objects', () => {
      const original = { name: 'Alice', age: 30, active: true };
      const rillVal = jsToRill(original);
      const result = rillToJs(rillVal);
      expect(result).toEqual(original);
    });

    it('preserves nested objects', () => {
      const original = {
        user: { name: 'Alice', profile: { age: 30 } },
        active: true,
      };
      const rillVal = jsToRill(original);
      const result = rillToJs(rillVal);
      expect(result).toEqual(original);
    });

    it('preserves tagged values (Ok/Err)', () => {
      const okTag: Value = {
        kind: 'Tag',
        tag: 'Ok',
        args: [{ kind: 'String', value: 'success' }],
      };
      const okJs = rillToJs(okTag);
      expect(okJs).toEqual({ tag: 'Ok', value: 'success' });

      const errTag: Value = {
        kind: 'Tag',
        tag: 'Err',
        args: [{ kind: 'String', value: 'failure' }],
      };
      const errJs = rillToJs(errTag);
      expect(errJs).toEqual({ tag: 'Err', value: 'failure' });
    });

    it('preserves SessionState-shaped complex structure', () => {
      const sessionState = {
        sessionId: 'sess-123',
        routineId: 'routine-456',
        phase: 'working' as const,
        exerciseIndex: 2,
        setIndex: 1,
        supersetPosition: 0,
        restDeadlineMs: 1688000000000,
        loggedSets: [
          {
            exerciseId: 'ex1',
            setType: 'warmup' as const,
            reps: 10,
            weightKg: 20.5,
            durationSeconds: null,
            rpe: 6.5,
          },
          {
            exerciseId: 'ex1',
            setType: 'working' as const,
            reps: 8,
            weightKg: 25.0,
            durationSeconds: null,
            rpe: 8.5,
          },
        ],
        startedAtMs: 1687900000000,
      };

      const rillVal = jsToRill(sessionState);
      const result = rillToJs(rillVal);
      expect(result).toEqual(sessionState);
    });
  });

  describe('evaluateSource', () => {
    it('evaluates simple arithmetic', () => {
      const result = evaluateSource('2 + 3', {});
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
      expect(result.error).toBeUndefined();
    });

    it('evaluates with injected data', () => {
      const result = evaluateSource('x + y', { x: 10, y: 20 });
      expect(result.success).toBe(true);
      expect(result.value).toBe(30);
    });

    it('evaluates with complex injected object', () => {
      const result = evaluateSource(
        '{ name: user.name, age: user.age }',
        { user: { name: 'Alice', age: 30 } }
      );
      expect(result.success).toBe(true);
      expect(result.value).toEqual({ name: 'Alice', age: 30 });
    });

    it('handles runtime errors gracefully', () => {
      const result = evaluateSource('1 / 0', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('handles undefined variable errors', () => {
      const result = evaluateSource('unknownVar + 5', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/unknown|undefined/i);
    });

    it('handles parse errors', () => {
      const result = evaluateSource('this is not valid rill', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns success: false (not throw) for type mismatches', () => {
      // A source that will fail type checking
      const result = evaluateSource('if (5) { 1 } else { "two" }', {});
      // This should fail (branches return different types)
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('validates missing rule parameters', () => {
      const result = evaluateSource(
        'rule myFunc(x: Int) -> Int { x + 1 } myFunc()',
        {}
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('RuleResult interface', () => {
    it('has correct shape on success', () => {
      const result = evaluateSource('42', {});
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('value');
      expect(result).not.toHaveProperty('error');
    });

    it('has correct shape on failure', () => {
      const result = evaluateSource('badVar', {});
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);
    });
  });
});
