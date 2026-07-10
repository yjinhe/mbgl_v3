import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { bpStatus, glucoseStatus, lipidStatus, uricStatus } from '../../../packages/shared/src/index';

type MiniMetrics = {
  bpStatus(sbp: number, dbp: number): { key: string };
  glucoseStatus(value: number, period: string, target?: unknown): { key: string };
  lipidItemStatus(key: string, value: number): { key: string };
  uricStatus(value: number, sex: string): { key: string };
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
    for (const [value, period] of [[3.8, 'fasting'], [3.9, 'fasting'], [7.0, 'fasting'], [7.1, 'fasting'], [10, 'after_lunch'], [16.8, 'after_lunch']] as const) {
      expect(mini.glucoseStatus(value, period).key).toBe(glucoseStatus(value, period).key);
    }
  });

  test('blood pressure status boundaries stay aligned', () => {
    for (const [sbp, dbp] of [[89, 60], [120, 80], [135, 85], [160, 100], [185, 115]] as const) {
      expect(mini.bpStatus(sbp, dbp).key).toBe(bpStatus(sbp, dbp).key);
    }
  });

  test('lipid status boundaries stay aligned', () => {
    for (const [key, value] of [['tc', 5.2], ['tg', 2.3], ['ldl', 4.1], ['hdl', 0.9], ['hdl', 1.0]] as const) {
      expect(mini.lipidItemStatus(key, value).key).toBe(lipidStatus(key, value).key);
    }
  });

  test('uric acid status boundaries stay aligned', () => {
    for (const [value, sex] of [[149, 'male'], [420, 'male'], [421, 'male'], [360, 'female'], [541, 'female']] as const) {
      expect(mini.uricStatus(value, sex).key).toBe(uricStatus(value, sex).key);
    }
  });
});
