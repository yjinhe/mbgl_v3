import type { LipidValues, Status } from './types.js';

export type LipidItem = 'tc' | 'tg' | 'ldl' | 'hdl';

export function lipidStatus(item: LipidItem, value: number): Status {
  if (item === 'hdl') {
    return value >= 1.0 ? { key: 'ok', label: '合适' } : { key: 'hi', label: '偏低' };
  }
  const thresholds = {
    tc: [5.2, 6.2],
    tg: [1.7, 2.3],
    ldl: [3.4, 4.1]
  } satisfies Record<Exclude<LipidItem, 'hdl'>, [number, number]>;
  const [hi, dhigh] = thresholds[item];
  if (value < hi) return { key: 'ok', label: '合适' };
  if (value < dhigh) return { key: 'hi', label: '边缘升高' };
  return { key: 'dhigh', label: '升高' };
}

export function lipidOverallStatus(values: LipidValues): Status {
  const order = { ok: 0, hi: 1, dhigh: 2 };
  let worst: Status = { key: 'ok', label: '合适' };
  for (const item of ['tc', 'tg', 'ldl', 'hdl'] as const) {
    const value = values[item];
    if (value == null) continue;
    const status = lipidStatus(item, value);
    if (order[status.key as keyof typeof order] > order[worst.key as keyof typeof order]) {
      worst = status;
    }
  }
  if (worst.key === 'hi') return { key: 'hi', label: '边缘升高' };
  return worst;
}

export function validateLipid(values: LipidValues): { ok: boolean; status?: Status; message?: string } {
  let hasValue = false;
  for (const item of ['tc', 'tg', 'ldl', 'hdl'] as const) {
    const value = values[item];
    if (value == null) continue;
    hasValue = true;
    if (!Number.isFinite(value) || value < 0.1 || value > 30) {
      return { ok: false, message: '血脂数值超出有效范围（0.1–30 mmol/L）' };
    }
  }
  if (!hasValue) return { ok: false, message: '请至少填写一项血脂指标' };
  return { ok: true, status: lipidOverallStatus(values) };
}
