const metrics = [
  { key: 'glucose', name: '血糖', unit: 'mmol/L', color: '#0E7E6B', soft: '#E2F1EC' },
  { key: 'bp', name: '血压', unit: 'mmHg', color: '#3E63C9', soft: '#E8EDFA' },
  { key: 'lipid', name: '血脂', unit: 'mmol/L', color: '#C77B33', soft: '#FAF0E3' },
  { key: 'uric', name: '尿酸', unit: 'μmol/L', color: '#7A5BBF', soft: '#F0EAFA' }
];

const periodNames = {
  fasting: '空腹',
  post_meal_1h: '餐后1小时',
  post_meal_2h: '餐后2小时',
  after_breakfast: '早餐后',
  before_lunch: '午餐前',
  after_lunch: '午餐后',
  random: '随机',
  before_dinner: '晚餐前',
  after_dinner: '晚餐后',
  bedtime: '睡前',
  dawn: '凌晨',
  morning: '晨起',
  daytime: '白天',
  evening: '晚间',
  night: '夜间'
};

const glucosePeriods = ['fasting', 'post_meal_1h', 'post_meal_2h', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner', 'bedtime', 'dawn', 'random'];
const bpPeriods = ['morning', 'daytime', 'evening', 'night'];
const glucoseTags = ['运动后', '聚餐', '加餐', '感冒', '熬夜', '情绪波动'];
const bpTags = ['运动后', '情绪波动', '休息后'];
const lipidItems = [
  { key: 'tc', name: '总胆固醇', abbr: 'TC', ref: '<5.2' },
  { key: 'tg', name: '甘油三酯', abbr: 'TG', ref: '<1.7' },
  { key: 'ldl', name: '低密度脂蛋白', abbr: 'LDL-C', ref: '<3.4' },
  { key: 'hdl', name: '高密度脂蛋白', abbr: 'HDL-C', ref: '≥1.0' }
];

const statusColor = {
  ok: '#19A77E',
  hi: '#E8833A',
  lo: '#4A7DDB',
  dhigh: '#D6453D',
  dlow: '#D6453D'
};

function metricByKey(key) {
  return metrics.find((item) => item.key === key) || metrics[0];
}

function statusClass(status) {
  if (!status || !status.key) return 'mut';
  if (status.key === 'dhigh' || status.key === 'dlow') return 'danger';
  return status.key;
}

function statusStyle(status) {
  return `color:${statusColor[status && status.key] || '#7A8A85'}`;
}

function neutralStatusLabel(status) {
  if (!status) return '';
  if (status.key === 'dlow') return '明显偏低';
  if (status.key === 'dhigh') return '明显偏高';
  return status.label || '';
}

function inferGlucosePeriod(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
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

function inferBpPeriod(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour >= 4 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'daytime';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function glucoseStatus(value, period, target) {
  const v = Math.round(Number(value) * 100) / 100;
  const goals = target || { fastingLow: 4.4, fastingHigh: 7, postMealHigh: 10 };
  const fastPeriods = ['fasting', 'before_lunch', 'before_dinner', 'bedtime', 'dawn'];
  const high = fastPeriods.includes(period) ? goals.fastingHigh : goals.postMealHigh;
  if (v < 3.9) return { key: 'dlow', label: '明显偏低' };
  if (v > 16.7) return { key: 'dhigh', label: '明显偏高' };
  if (v > high) return { key: 'hi', label: '偏高' };
  if (v < goals.fastingLow) return { key: 'lo', label: '偏低' };
  return { key: 'ok', label: '达标' };
}

function bpStatus(sbp, dbp) {
  const s = Number(sbp);
  const d = Number(dbp);
  // Mirrors packages/shared/src/bp.ts: high readings take priority so a low
  // value in one component does not mask an elevated one (e.g. 165/55).
  if (s >= 160 || d >= 100) return { key: 'dhigh', label: '明显偏高' };
  if (s >= 135 || d >= 85) return { key: 'hi', label: '偏高' };
  if (s < 90 || d < 60) return { key: 'dlow', label: '偏低' };
  return { key: 'ok', label: '正常' };
}

function lipidItemStatus(key, value) {
  const v = Number(value);
  if (key === 'hdl') return v >= 1 ? { key: 'ok', label: '合适' } : { key: 'lo', label: '偏低' };
  if (key === 'tc') {
    if (v < 5.2) return { key: 'ok', label: '合适' };
    if (v < 6.2) return { key: 'hi', label: '边缘升高' };
    return { key: 'dhigh', label: '升高' };
  }
  if (key === 'tg') {
    if (v < 1.7) return { key: 'ok', label: '合适' };
    if (v < 2.3) return { key: 'hi', label: '边缘升高' };
    return { key: 'dhigh', label: '升高' };
  }
  if (v < 3.4) return { key: 'ok', label: '合适' };
  if (v < 4.1) return { key: 'hi', label: '边缘升高' };
  return { key: 'dhigh', label: '升高' };
}

function uricStatus(value, sex) {
  const v = Number(value);
  const threshold = sex === 'female' ? 360 : 420;
  if (v < 150) return { key: 'lo', label: '偏低' };
  if (v <= threshold) return { key: 'ok', label: '达标' };
  if (v <= 540) return { key: 'hi', label: '偏高' };
  return { key: 'dhigh', label: '明显偏高' };
}

function glucoseUnitText(unit) {
  return unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
}

function displayGlucoseValue(valueMmol, unit) {
  if (valueMmol == null) return '—';
  return unit === 'mgdl' ? String(Math.round(Number(valueMmol) * 18)) : Number(valueMmol).toFixed(1);
}

function readRecord(metric, record, unit = 'mmol') {
  if (metric === 'glucose') {
    const displayUnit = record.displayUnit || glucoseUnitText(unit);
    return `${record.displayValue || record.valueMmol} ${displayUnit}`;
  }
  if (metric === 'bp') return `${record.sbp}/${record.dbp} mmHg${record.pulse ? ` · ♥${record.pulse}` : ''}`;
  if (metric === 'uric') return `${record.value} μmol/L`;
  return lipidItems
    .filter((item) => record[item.key] != null)
    .map((item) => `${item.abbr} ${record[item.key]}`)
    .join(' · ');
}

module.exports = {
  bpPeriods,
  bpStatus,
  bpTags,
  glucosePeriods,
  glucoseStatus,
  glucoseTags,
  glucoseUnitText,
  displayGlucoseValue,
  inferBpPeriod,
  inferGlucosePeriod,
  lipidItemStatus,
  lipidItems,
  metricByKey,
  metrics,
  periodNames,
  readRecord,
  neutralStatusLabel,
  statusClass,
  statusColor,
  statusStyle,
  uricStatus
};
