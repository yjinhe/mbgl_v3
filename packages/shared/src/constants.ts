import type { GlucosePeriod, GlucoseTarget } from './types.js';

export const DEFAULT_GLUCOSE_TARGET: GlucoseTarget = {
  fastingLow: 4.4,
  fastingHigh: 7.0,
  postMealHigh: 10.0
};

export const GLUCOSE_PERIODS: Array<{
  key: GlucosePeriod;
  name: string;
  type: 'fast' | 'post';
}> = [
  { key: 'fasting', name: '空腹', type: 'fast' },
  { key: 'post_meal_1h', name: '餐后1小时', type: 'post' },
  { key: 'post_meal_2h', name: '餐后2小时', type: 'post' },
  { key: 'after_breakfast', name: '早餐后', type: 'post' },
  { key: 'before_lunch', name: '午餐前', type: 'fast' },
  { key: 'after_lunch', name: '午餐后', type: 'post' },
  { key: 'random', name: '随机', type: 'post' },
  { key: 'before_dinner', name: '晚餐前', type: 'fast' },
  { key: 'after_dinner', name: '晚餐后', type: 'post' },
  { key: 'bedtime', name: '睡前', type: 'fast' },
  { key: 'dawn', name: '凌晨', type: 'fast' }
];

export const GLUCOSE_PERIOD_MAP = Object.fromEntries(
  GLUCOSE_PERIODS.map((period) => [period.key, period])
) as Record<GlucosePeriod, (typeof GLUCOSE_PERIODS)[number]>;

export const BP_PERIOD_NAMES = {
  morning: '晨起',
  daytime: '白天',
  evening: '晚间',
  night: '夜间'
} as const;

export const STATUS_WEIGHT = {
  dlow: 4,
  lo: 1,
  ok: 0,
  hi: 2,
  dhigh: 4
} as const;

export const STATUS_LABELS = {
  glucose: {
    dlow: '低血糖',
    lo: '偏低',
    ok: '达标',
    hi: '偏高',
    dhigh: '显著偏高'
  },
  bp: {
    dlow: '偏低',
    ok: '正常',
    hi: '偏高',
    dhigh: '明显偏高'
  },
  lipid: {
    ok: '合适',
    hi: '边缘升高',
    dhigh: '升高'
  },
  uric: {
    lo: '偏低',
    ok: '达标',
    hi: '偏高',
    dhigh: '显著偏高'
  }
} as const;
