import { DEFAULT_GLUCOSE_TARGET, GLUCOSE_PERIOD_MAP } from './constants.js';
import { shanghaiHour } from './time.js';
import type { GlucosePeriod, GlucoseTarget, Status, Unit } from './types.js';

export function toMmol(value: number, unit: Unit): number {
  return unit === 'mgdl' ? value / 18 : value;
}

export function fromMmol(valueMmol: number, unit: Unit): number {
  return unit === 'mgdl' ? valueMmol * 18 : valueMmol;
}

export function displayGlucose(valueMmol: number, unit: Unit): string {
  return unit === 'mgdl' ? String(Math.round(valueMmol * 18)) : valueMmol.toFixed(1);
}

export function inferGlucosePeriod(value: Date | string): GlucosePeriod {
  const hour = shanghaiHour(value);
  if (hour >= 5 && hour < 9) return 'fasting';
  if (hour >= 9 && hour < 11) return 'after_breakfast';
  if (hour >= 11 && hour < 12) return 'before_lunch';
  if (hour >= 12 && hour < 15) return 'after_lunch';
  if (hour >= 15 && hour < 17) return 'random';
  if (hour >= 17 && hour < 18.5) return 'before_dinner';
  if (hour >= 18.5 && hour < 21.5) return 'after_dinner';
  if (hour >= 21.5) return 'bedtime';
  return 'dawn';
}

export function glucoseStatus(
  rawValueMmol: number,
  period: GlucosePeriod,
  target: GlucoseTarget = DEFAULT_GLUCOSE_TARGET
): Status {
  const valueMmol = Math.round(rawValueMmol * 100) / 100;
  if (valueMmol < 3.9) return { key: 'dlow', label: '低血糖' };
  if (valueMmol > 16.7) return { key: 'dhigh', label: '显著偏高' };

  const upper = GLUCOSE_PERIOD_MAP[period].type === 'fast' ? target.fastingHigh : target.postMealHigh;
  if (valueMmol > upper) return { key: 'hi', label: '偏高' };
  if (valueMmol < target.fastingLow) return { key: 'lo', label: '偏低' };
  return { key: 'ok', label: '达标' };
}

export function validateGlucose(value: number, unit: Unit): { ok: boolean; valueMmol?: number; message?: string } {
  if (!Number.isFinite(value)) return { ok: false, message: '请输入血糖值' };
  const unitValid = unit === 'mgdl' ? value >= 20 && value <= 600 : value >= 1.1 && value <= 33.3;
  if (!unitValid) {
    return { ok: false, message: '请输入有效范围内的数值（1.1–33.3 mmol/L，即 20–600 mg/dL）' };
  }
  const valueMmol = unit === 'mgdl' ? Math.min(33.3, Math.max(1.1, toMmol(value, unit))) : value;
  return { ok: true, valueMmol: Math.round(valueMmol * 100) / 100 };
}

export function glucoseSafetyAlert(valueMmol: number): 'low' | 'high' | null {
  if (valueMmol < 3.9) return 'low';
  if (valueMmol > 16.7) return 'high';
  return null;
}

export function glucoseTir(valuesMmol: number[]): { low: number; inRange: number; high: number } {
  if (valuesMmol.length === 0) return { low: 0, inRange: 0, high: 0 };
  const low = valuesMmol.filter((value) => value < 3.9).length / valuesMmol.length;
  const inRange = valuesMmol.filter((value) => value >= 3.9 && value <= 10.0).length / valuesMmol.length;
  const high = valuesMmol.filter((value) => value > 10.0).length / valuesMmol.length;
  return { low, inRange, high };
}

export function gmiFromAverage(avgMmol: number): number {
  return 3.31 + 0.02392 * (avgMmol * 18);
}

export function validateGlucoseTarget(target: GlucoseTarget): boolean {
  return (
    target.fastingLow >= 3.0 &&
    target.fastingLow <= 6.0 &&
    target.fastingHigh >= 5.0 &&
    target.fastingHigh <= 10.0 &&
    target.postMealHigh >= 6.0 &&
    target.postMealHigh <= 15.0 &&
    target.fastingLow < target.fastingHigh &&
    target.fastingHigh <= target.postMealHigh
  );
}
