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

// One-time subscription message copy for measurement reminders. WeChat `thing` fields allow at most 20 characters.
export const REMINDER_TIPS: Record<GlucosePeriod, string> = {
  fasting: '起床后先测再吃早饭',
  post_meal_1h: '从第一口饭算起一小时',
  post_meal_2h: '从第一口饭算起两小时',
  after_breakfast: '从第一口饭算起两小时',
  before_lunch: '饭前测，洗净手指',
  after_lunch: '从第一口饭算起两小时',
  random: '想起来就测一下',
  before_dinner: '饭前测，洗净手指',
  after_dinner: '从第一口饭算起两小时',
  bedtime: '睡前测一次更安心',
  dawn: '凌晨三点左右测'
};

export const BP_REMINDER_NOTE = '静坐五分钟后再量';

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
    lo: '偏低',
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
