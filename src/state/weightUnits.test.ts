import { LBS_PER_KG, formatWeightLbs, kgToLbs, lbsToKg } from './weightUnits';

/**
 * Test: weight unit conversion (item 1)
 *
 * lbs is a display/entry concern only — kg stays canonical in the engine, DB,
 * vault markdown and HealthKit. Entry converts lbs → kg (2 dp, keeps
 * vault files readable); display converts kg → lbs rounded to the nearest
 * 0.5 lb so entered values echo back exactly.
 */

describe('weightUnits', () => {
  test('uses the standard conversion factor', () => {
    expect(LBS_PER_KG).toBe(2.20462);
  });

  describe('lbsToKg', () => {
    test('converts entry lbs to storage kg rounded to 2 decimals', () => {
      expect(lbsToKg(135)).toBe(61.24);
      expect(lbsToKg(55)).toBe(24.95);
      expect(lbsToKg(2.5)).toBe(1.13);
    });

    test('keeps 0 at 0 so the engine 0-to-undefined sentinel is unchanged', () => {
      expect(lbsToKg(0)).toBe(0);
    });
  });

  describe('kgToLbs', () => {
    test('rounds display values to the nearest 0.5 lb', () => {
      expect(kgToLbs(20)).toBe(44);
      expect(kgToLbs(100)).toBe(220.5);
      expect(kgToLbs(102.5)).toBe(226);
    });

    test('keeps 0 at 0', () => {
      expect(kgToLbs(0)).toBe(0);
    });
  });

  test('common plate values survive entry, storage, and display unchanged', () => {
    const plateValues = [0.5, 2.5, 5, 45, 47.5, 95, 135, 225, 315];
    for (const lbs of plateValues) {
      expect(kgToLbs(lbsToKg(lbs))).toBe(lbs);
    }
  });

  describe('formatWeightLbs', () => {
    test('owns the lbs suffix so read sites cannot regress to kg', () => {
      expect(formatWeightLbs(100)).toBe('220.5lbs');
      expect(formatWeightLbs(20)).toBe('44lbs');
    });
  });
});
