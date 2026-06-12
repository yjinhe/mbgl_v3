import { addDaysToKey, localDayKey, todayShanghaiKey } from './time.js';

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

export function coefficientOfVariation(values: number[]): number {
  const avg = average(values);
  return avg === 0 ? 0 : (standardDeviation(values) / avg) * 100;
}

export function streakFromDayKeys(dayKeys: Iterable<string>, now: Date = new Date()): number {
  const days = new Set(dayKeys);
  let cursor = todayShanghaiKey(now);
  if (!days.has(cursor)) cursor = addDaysToKey(cursor, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDaysToKey(cursor, -1);
  }
  return streak;
}

export function dayKeysFromDates(values: Array<Date | string>): string[] {
  return values.map((value) => localDayKey(value));
}
