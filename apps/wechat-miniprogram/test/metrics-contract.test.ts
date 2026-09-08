import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { bpStatus, glucoseStatus, lipidStatus, uricStatus } from '../../../packages/shared/src/index';

type MiniMetrics = {
  bpStatus(sbp: number, dbp: number): { key: string };
  glucoseStatus(value: number, period: string, target?: unknown): { key: string };
  lipidItemStatus(key: string, value: number): { key: string };
  uricStatus(value: number, sex: string): { key: string };
  displayGlucoseValue(value: number | null, unit: string): string;
  glucoseUnitText(unit: string): string;
  readRecord(metric: string, record: Record<string, unknown>, unit?: string): string;
};

function loadMiniMetrics(): MiniMetrics {
  const filename = path.resolve(__dirname, '../utils/metrics.js');
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} as MiniMetrics };
  Function('module', 'exports', source)(module, module.exports);
  return module.exports;
}

const mini = loadMiniMetrics();

describe('mini-program metric rules match shared domain rules', () => {
  test('glucose status boundaries stay aligned', () => {
    for (const [value, period] of [[3.8, 'fasting'], [3.9, 'fasting'], [7.0, 'fasting'], [7.1, 'fasting'], [10, 'after_lunch'], [10.1, 'post_meal_1h'], [10.1, 'post_meal_2h'], [16.8, 'after_lunch']] as const) {
      expect(mini.glucoseStatus(value, period).key).toBe(glucoseStatus(value, period).key);
    }
  });

  test('blood pressure status boundaries stay aligned', () => {
    for (const [sbp, dbp, expected] of [[89, 60, 'dlow'], [120, 80, 'ok'], [135, 85, 'hi'], [160, 100, 'dhigh'], [185, 115, 'dhigh'], [165, 55, 'dhigh'], [85, 55, 'dlow']] as const) {
      expect(mini.bpStatus(sbp, dbp).key).toBe(expected);
      expect(mini.bpStatus(sbp, dbp).key).toBe(bpStatus(sbp, dbp).key);
    }
  });

  test('lipid status boundaries stay aligned', () => {
    for (const [key, value, expected] of [['tc', 5.2, 'hi'], ['tg', 2.3, 'dhigh'], ['ldl', 4.1, 'dhigh'], ['hdl', 0.9, 'lo'], ['hdl', 1.0, 'ok']] as const) {
      expect(mini.lipidItemStatus(key, value).key).toBe(expected);
      expect(mini.lipidItemStatus(key, value).key).toBe(lipidStatus(key, value).key);
    }
  });

  test('uric acid status boundaries stay aligned', () => {
    for (const [value, sex] of [[149, 'male'], [420, 'male'], [421, 'male'], [360, 'female'], [541, 'female']] as const) {
      expect(mini.uricStatus(value, sex).key).toBe(uricStatus(value, sex).key);
    }
  });

  test('formats glucose values and units consistently', () => {
    expect(mini.displayGlucoseValue(7.2, 'mmol')).toBe('7.2');
    expect(mini.displayGlucoseValue(7.2, 'mgdl')).toBe('130');
    expect(mini.glucoseUnitText('mgdl')).toBe('mg/dL');
    expect(mini.readRecord('glucose', { displayValue: '130', valueMmol: 7.2 }, 'mgdl')).toBe('130 mg/dL');
    expect(mini.readRecord('glucose', { displayValue: '7.2', displayUnit: 'mmol/L', valueMmol: 7.2 }, 'mgdl')).toBe('7.2 mmol/L');
  });
});
