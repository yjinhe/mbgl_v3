const { displayGlucoseValue, glucoseUnitText, lipidItems, periodNames } = require('./metrics');

const DAY_MS = 86400000;
const PERIOD_FILTERS = [
  { key: 'all', name: '全部', description: '全部时段' },
  { key: 'fasting', name: '空腹', description: '空腹' },
  { key: 'post_meal_1h', name: '餐一', description: '餐后1小时' },
  { key: 'post_meal_2h', name: '餐二', description: '餐后2小时' }
];

function dateParts(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, time: '' };
  const date = new Date(new Date(value).getTime() + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  const iso = date.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function seriesPoints(data) {
  const series = data && data.series;
  return Array.isArray(series) ? series : (series && Array.isArray(series.points) ? series.points : []);
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const valid = values.filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function valueText(value, metric, unit) {
  if (finite(value) === null) return '—';
  if (metric === 'glucose') return displayGlucoseValue(value, unit);
  return metric === 'lipid' ? Number(value).toFixed(2) : String(Math.round(value));
}

function recordValues(metric, point, unit) {
  if (metric === 'glucose') return [`${valueText(point.valueMmol, metric, unit)} ${glucoseUnitText(unit)}`];
  if (metric === 'bp') return [`${valueText(point.sbp, metric)}/${valueText(point.dbp, metric)} mmHg${finite(point.pulse) !== null ? `  心率 ${point.pulse}` : ''}`];
  if (metric === 'uric') return [`${valueText(point.value, metric)} μmol/L`];
  return [
    `TC ${valueText(point.tc, metric)}  TG ${valueText(point.tg, metric)}`,
    `LDL-C ${valueText(point.ldl, metric)}  HDL-C ${valueText(point.hdl, metric)}`
  ];
}

function buildStatsView(data, options = {}) {
  const { metric = 'glucose', range = 7, period = 'all', lipidKey = 'tc', unit = 'mmol', now = new Date() } = options;
  const today = dateParts(now).date;
  const todayMs = new Date(`${today}T00:00:00+08:00`).getTime();
  const from = dateParts(new Date(todayMs - (range - 1) * DAY_MS)).date;
  const points = seriesPoints(data).filter((point) => {
    const date = dateParts(point.measuredAt || point.date).date;
    return date >= from && date <= today && (metric !== 'glucose' || period === 'all' || point.period === period);
  }).slice().sort((a, b) => String(a.measuredAt || a.date).localeCompare(String(b.measuredAt || b.date)));
  const primaryKey = metric === 'glucose' ? 'valueMmol' : metric === 'bp' ? 'sbp' : metric === 'lipid' ? lipidKey : 'value';
  const primary = points.map((point) => finite(point[primaryKey]));
  const secondary = metric === 'bp' ? points.map((point) => finite(point.dbp)) : [];
  const primaryValid = primary.filter((value) => value !== null);
  const displayUnit = metric === 'glucose' ? glucoseUnitText(unit) : metric === 'bp' ? 'mmHg' : metric === 'uric' ? 'μmol/L' : 'mmol/L';
  const selectedLipid = lipidItems.find((item) => item.key === lipidKey) || lipidItems[0];
  const selectedPeriod = PERIOD_FILTERS.find((item) => item.key === period) || PERIOD_FILTERS[0];
  const caption = metric === 'glucose' ? selectedPeriod.description : metric === 'bp' ? '收缩压 / 舒张压' : metric === 'lipid' ? `${selectedLipid.name} ${selectedLipid.abbr}` : '尿酸';
  const days = Array.from({ length: range }, (_, index) => {
    const date = dateParts(new Date(todayMs - (range - 1 - index) * DAY_MS)).date;
    const items = points.filter((point) => dateParts(point.measuredAt || point.date).date === date);
    const value = average(items.map((point) => finite(point[primaryKey])));
    const secondValue = metric === 'bp' ? average(items.map((point) => finite(point.dbp))) : null;
    return { id: date, dateText: date.slice(5).replace('-', '/'), count: items.filter((point) => finite(point[primaryKey]) !== null).length, value, secondValue, valueText: valueText(value, metric, unit), secondText: valueText(secondValue, metric, unit), missing: value === null };
  });
  const peak = Math.max(0, ...days.flatMap((day) => [day.value || 0, day.secondValue || 0]));
  const scaleMax = peak > 0 ? Math.ceil(peak * 1.15 * (metric === 'glucose' || metric === 'lipid' ? 10 : 1)) / (metric === 'glucose' || metric === 'lipid' ? 10 : 1) : 1;
  days.forEach((day) => {
    day.height = day.value === null ? 0 : day.value / scaleMax * 180;
    day.secondHeight = day.secondValue === null ? 0 : day.secondValue / scaleMax * 180;
  });
  const summary = [
    { label: metric === 'lipid' ? `${selectedLipid.abbr} 有数值` : '记录数', value: primaryValid.length, unit: '次' },
    { label: metric === 'bp' ? '平均收缩压' : '平均值', value: valueText(average(primary), metric, unit), unit: displayUnit },
    { label: metric === 'bp' ? '平均舒张压' : '最高值', value: valueText(metric === 'bp' ? average(secondary) : primaryValid.length ? Math.max(...primaryValid) : null, metric, unit), unit: displayUnit },
    { label: metric === 'bp' ? '最近一次' : '最低值', value: metric === 'bp' && points.length ? `${valueText(points[points.length - 1].sbp, metric)}/${valueText(points[points.length - 1].dbp, metric)}` : valueText(primaryValid.length ? Math.min(...primaryValid) : null, metric, unit), unit: displayUnit }
  ];
  return {
    summary, bars: days, hasBars: primaryValid.length > 0, chartCaption: caption, chartUnit: displayUnit,
    chartMax: valueText(scaleMax, metric, unit), rangeText: `${from.replace(/-/g, '/')} — ${today.replace(/-/g, '/')}`, totalCount: points.length,
    detailRows: points.slice().reverse().map((point, index) => {
      const date = dateParts(point.measuredAt || point.date);
      return { id: point.id || `${date.date}:${date.time}:${index}`, dateText: date.date.replace(/-/g, '/'), timeText: date.time, periodText: periodNames[point.period] || (metric === 'lipid' ? '化验' : ''), lines: recordValues(metric, point, unit), unitText: metric === 'lipid' ? '单位：mmol/L' : '' };
    })
  };
}

module.exports = { PERIOD_FILTERS, buildStatsView, dateParts, finite, recordValues, seriesPoints };
