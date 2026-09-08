import { describe, expect, test } from 'vitest';
import {
  DEFAULT_GLUCOSE_TARGET,
  GLUCOSE_PERIOD_MAP,
  bpSafetyAlert,
  displayGlucose,
  glucoseSafetyAlert,
  glucoseStatus,
  glucoseTir,
  gmiFromAverage,
  inferBpPeriod,
  inferGlucosePeriod,
  lipidOverallStatus,
  lipidStatus,
  streakFromDayKeys,
  toMmol,
  uricSafetyAlert,
  uricStatus,
  validateBp,
  validateGlucose,
  validateLipid,
  validateUric
} from '../src/index.js';

function t(hhmm: string) {
  return new Date(`2026-06-12T${hhmm}:00+08:00`);
}

describe('glucose rules', () => {
  test('converts and displays glucose units', () => {
    expect(toMmol(200, 'mgdl')).toBeCloseTo(11.11, 2);
    expect(displayGlucose(6.1, 'mgdl')).toBe('110');
    expect(toMmol(Number(displayGlucose(6.1, 'mgdl')), 'mgdl')).toBeCloseTo(6.1, 0.06);
  });

  test.each([
    ['04:59', 'dawn'],
    ['05:00', 'fasting'],
    ['08:59', 'fasting'],
    ['09:00', 'after_breakfast'],
    ['11:59', 'before_lunch'],
    ['12:00', 'after_lunch'],
    ['14:59', 'after_lunch'],
    ['15:00', 'random'],
    ['18:29', 'before_dinner'],
    ['18:30', 'after_dinner'],
    ['21:29', 'after_dinner'],
    ['21:30', 'bedtime'],
    ['00:00', 'dawn']
  ] as const)('infers %s as %s', (time, period) => {
    expect(inferGlucosePeriod(t(time))).toBe(period);
  });

  test.each([
    [3.89, 'fasting', 'dlow'],
    [3.9, 'fasting', 'lo'],
    [4.39, 'fasting', 'lo'],
    [4.4, 'fasting', 'ok'],
    [7.0, 'fasting', 'ok'],
    [7.1, 'fasting', 'hi'],
    [10.0, 'after_lunch', 'ok'],
    [10.1, 'after_lunch', 'hi'],
    [16.7, 'after_lunch', 'hi'],
    [16.71, 'after_lunch', 'dhigh'],
    [33.3, 'after_lunch', 'dhigh']
  ] as const)('classifies glucose %s %s as %s', (value, period, key) => {
    expect(glucoseStatus(value, period, DEFAULT_GLUCOSE_TARGET).key).toBe(key);
  });

  test('keeps one-hour and two-hour post-meal records distinct while using post-meal targets', () => {
    expect(GLUCOSE_PERIOD_MAP.post_meal_1h.name).toBe('餐后1小时');
    expect(GLUCOSE_PERIOD_MAP.post_meal_2h.name).toBe('餐后2小时');
    expect(GLUCOSE_PERIOD_MAP.post_meal_1h.type).toBe('post');
    expect(GLUCOSE_PERIOD_MAP.post_meal_2h.type).toBe('post');
    expect(glucoseStatus(10.1, 'post_meal_1h', DEFAULT_GLUCOSE_TARGET).key).toBe('hi');
    expect(glucoseStatus(10.1, 'post_meal_2h', DEFAULT_GLUCOSE_TARGET).key).toBe('hi');
  });

  test.each([
    [1.0, 'mmol', false],
    [1.1, 'mmol', true],
    [33.3, 'mmol', true],
    [33.4, 'mmol', false],
    [19, 'mgdl', false],
    [20, 'mgdl', true],
    [600, 'mgdl', true],
    [601, 'mgdl', false]
  ] as const)('validates glucose %s %s', (value, unit, valid) => {
    expect(validateGlucose(value, unit).ok).toBe(valid);
  });

  test('calculates GMI, TIR, CV-related inputs and safety', () => {
    expect(gmiFromAverage(7.5)).toBeCloseTo(6.5, 1);
    expect(glucoseTir([3.5, 5, 8, 10, 10.1])).toEqual({ low: 0.2, inRange: 0.6, high: 0.2 });
    expect(glucoseSafetyAlert(3.5)).toBe('low');
    expect(glucoseSafetyAlert(17)).toBe('high');
    expect(glucoseSafetyAlert(8)).toBeNull();
  });
});

describe('blood pressure rules', () => {
  test.each([
    [89, 70, 'dlow'],
    [90, 59, 'dlow'],
    [134, 84, 'ok'],
    [135, 84, 'hi'],
    [134, 85, 'hi'],
    [159, 99, 'hi'],
    [160, 99, 'dhigh'],
    [159, 100, 'dhigh'],
    [165, 55, 'dhigh'],
    [140, 55, 'hi'],
    [85, 55, 'dlow']
  ] as const)('classifies %s/%s as %s', (sbp, dbp, key) => {
    expect(validateBp({ sbp, dbp }).status?.key).toBe(key);
  });

  test('validates ranges and safety alerts', () => {
    expect(validateBp({ sbp: 120, dbp: 130 }).ok).toBe(false);
    expect(validateBp({ sbp: 301, dbp: 90 }).ok).toBe(false);
    expect(validateBp({ sbp: 120, dbp: 80, pulse: 25 }).ok).toBe(false);
    expect(bpSafetyAlert(179, 109)).toBeNull();
    expect(bpSafetyAlert(180, 108)).toBe('high');
    expect(bpSafetyAlert(90, 60)).toBeNull();
    expect(bpSafetyAlert(89, 60)).toBe('low');
  });

  test.each([
    ['03:59', 'night'],
    ['04:00', 'morning'],
    ['09:59', 'morning'],
    ['10:00', 'daytime'],
    ['16:59', 'daytime'],
    ['17:00', 'evening'],
    ['21:59', 'evening'],
    ['22:00', 'night']
  ] as const)('infers %s as %s', (time, period) => {
    expect(inferBpPeriod(t(time))).toBe(period);
  });
});

describe('lipid rules', () => {
  test.each([
    ['tc', 5.19, 'ok'],
    ['tc', 5.2, 'hi'],
    ['tc', 6.19, 'hi'],
    ['tc', 6.2, 'dhigh'],
    ['tg', 1.69, 'ok'],
    ['tg', 1.7, 'hi'],
    ['tg', 2.29, 'hi'],
    ['tg', 2.3, 'dhigh'],
    ['ldl', 3.39, 'ok'],
    ['ldl', 3.4, 'hi'],
    ['ldl', 4.09, 'hi'],
    ['ldl', 4.1, 'dhigh'],
    ['hdl', 1.0, 'ok'],
    ['hdl', 0.99, 'lo']
  ] as const)('classifies %s %s as %s', (item, value, key) => {
    expect(lipidStatus(item, value).key).toBe(key);
  });

  test('chooses overall worst status and rejects all-empty lipid body', () => {
    expect(lipidOverallStatus({ tc: 4.8, tg: 1.2, ldl: 4.2, hdl: 1.2 }).key).toBe('dhigh');
    expect(lipidOverallStatus({ tc: 4.8, hdl: 0.9 })).toEqual({ key: 'lo', label: '偏低' });
    expect(lipidOverallStatus({ tc: 5.5, hdl: 0.9 }).key).toBe('hi');
    expect(lipidStatus('hdl', 0.9).label).toBe('偏低');
    expect(validateLipid({}).ok).toBe(false);
    expect(validateLipid({ tg: 1.2 }).ok).toBe(true);
  });
});

describe('uric acid rules', () => {
  test.each([
    ['male', 420, 'ok'],
    ['male', 421, 'hi'],
    ['male', 540, 'hi'],
    ['male', 541, 'dhigh'],
    ['female', 360, 'ok'],
    ['female', 361, 'hi'],
    [null, 420, 'ok'],
    [null, 421, 'hi'],
    ['male', 149, 'lo'],
    ['male', 150, 'ok']
  ] as const)('classifies %s %s as %s', (sex, value, key) => {
    expect(uricStatus(value, sex).key).toBe(key);
  });

  test('validates uric range and safety', () => {
    expect(validateUric(49).ok).toBe(false);
    expect(validateUric(50).ok).toBe(true);
    expect(validateUric(1500).ok).toBe(true);
    expect(validateUric(1501).ok).toBe(false);
    expect(uricSafetyAlert(541)).toBe('high');
  });
});

describe('cross metric streak', () => {
  test('counts consecutive days across metrics including today', () => {
    expect(streakFromDayKeys(['2026-06-11', '2026-06-12'], new Date('2026-06-12T10:00:00+08:00'))).toBe(2);
  });

  test('starts from yesterday when today has no records', () => {
    expect(
      streakFromDayKeys(
        ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11'],
        new Date('2026-06-12T10:00:00+08:00')
      )
    ).toBe(4);
  });
});
