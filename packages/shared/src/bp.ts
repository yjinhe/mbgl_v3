import { shanghaiHour } from './time.js';
import type { BpPeriod, Status } from './types.js';

export function inferBpPeriod(value: Date | string): BpPeriod {
  const hour = shanghaiHour(value);
  if (hour >= 4 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'daytime';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function bpStatus(sbp: number, dbp: number): Status {
  // High readings take priority: a low value in one component must not mask an elevated one (e.g. 165/55).
  if (sbp >= 160 || dbp >= 100) return { key: 'dhigh', label: '明显偏高' };
  if (sbp >= 135 || dbp >= 85) return { key: 'hi', label: '偏高' };
  if (sbp < 90 || dbp < 60) return { key: 'dlow', label: '偏低' };
  return { key: 'ok', label: '正常' };
}

export function validateBp(input: {
  sbp: number;
  dbp: number;
  pulse?: number | null;
}): { ok: boolean; status?: Status; message?: string } {
  const { sbp, dbp, pulse } = input;
  if (!Number.isInteger(sbp) || !Number.isInteger(dbp)) return { ok: false, message: '请输入血压值' };
  if (sbp < 50 || sbp > 300 || dbp < 30 || dbp > 200) {
    return { ok: false, message: '请输入有效范围内的血压值' };
  }
  if (sbp <= dbp) return { ok: false, message: '收缩压应高于舒张压，请检查输入' };
  if (pulse != null && (!Number.isInteger(pulse) || pulse < 30 || pulse > 220)) {
    return { ok: false, message: '请输入有效范围内的脉搏值' };
  }
  return { ok: true, status: bpStatus(sbp, dbp) };
}

export function bpSafetyAlert(sbp: number, dbp: number): 'low' | 'high' | null {
  if (sbp >= 180 || dbp >= 110) return 'high';
  if (sbp < 90 || dbp < 60) return 'low';
  return null;
}
