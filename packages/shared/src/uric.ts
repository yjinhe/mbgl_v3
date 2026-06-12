import type { Sex, Status } from './types.js';

export function uricThreshold(sex: Sex): number {
  return sex === 'female' ? 360 : 420;
}

export function uricStatus(value: number, sex: Sex): Status {
  const threshold = uricThreshold(sex);
  if (value < 150) return { key: 'lo', label: '偏低' };
  if (value <= threshold) return { key: 'ok', label: '达标' };
  if (value <= 540) return { key: 'hi', label: '偏高' };
  return { key: 'dhigh', label: '显著偏高' };
}

export function validateUric(value: number): { ok: boolean; message?: string } {
  if (!Number.isInteger(value)) return { ok: false, message: '请输入尿酸值' };
  if (value < 50 || value > 1500) return { ok: false, message: '请输入有效范围内的数值（50–1500 μmol/L）' };
  return { ok: true };
}

export function uricSafetyAlert(value: number): 'high' | null {
  return value > 540 ? 'high' : null;
}
