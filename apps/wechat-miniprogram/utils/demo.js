function atDaysAgo(days, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const demoMe = {
  nickname: '体验用户',
  sex: 'male',
  unit: 'mmol',
  target: { fastingLow: 4.4, fastingHigh: 7, postMealHigh: 10 },
  stats: { totalRecords: 12, coveredDays: 7 }
};

function demoOverview() {
  return {
    todayCount: 2,
    streak: 7,
    glucose: {
      latest: {
        valueMmol: 6.2,
        displayValue: 6.2,
        period: 'fasting',
        measuredAt: atDaysAgo(0, 7, 30),
        status: { key: 'ok', label: '达标' }
      }
    },
    bp: {
      latest: {
        sbp: 128,
        dbp: 78,
        pulse: 72,
        period: 'morning',
        measuredAt: atDaysAgo(0, 7, 40),
        status: { key: 'ok', label: '正常' }
      }
    },
    lipid: {
      latest: {
        tc: 4.6,
        tg: 1.3,
        ldl: 2.7,
        hdl: 1.2,
        measuredAt: atDaysAgo(18, 9, 10),
        status: { key: 'ok', label: '合适' },
        itemStatus: { tc: 'ok', tg: 'ok', ldl: 'ok', hdl: 'ok' }
      }
    },
    uric: {
      latest: {
        value: 356,
        measuredAt: atDaysAgo(3, 8, 20),
        status: { key: 'ok', label: '达标' }
      }
    }
  };
}

function demoRecords(metric) {
  const records = {
    glucose: [
      { id: 'demo-g1', valueMmol: 6.2, displayValue: 6.2, period: 'fasting', measuredAt: atDaysAgo(0, 7, 30), note: '晨起记录', status: { key: 'ok', label: '达标' } },
      { id: 'demo-g2', valueMmol: 7.8, displayValue: 7.8, period: 'after_breakfast', measuredAt: atDaysAgo(1, 9, 15), note: '', status: { key: 'ok', label: '达标' } },
      { id: 'demo-g3', valueMmol: 6.5, displayValue: 6.5, period: 'before_dinner', measuredAt: atDaysAgo(2, 17, 40), note: '晚餐前', status: { key: 'ok', label: '达标' } }
    ],
    bp: [
      { id: 'demo-b1', sbp: 128, dbp: 78, pulse: 72, period: 'morning', measuredAt: atDaysAgo(0, 7, 40), note: '晨起记录', status: { key: 'ok', label: '正常' } },
      { id: 'demo-b2', sbp: 132, dbp: 82, pulse: 75, period: 'evening', measuredAt: atDaysAgo(1, 20, 10), note: '', status: { key: 'ok', label: '正常' } }
    ],
    lipid: [
      { id: 'demo-l1', tc: 4.6, tg: 1.3, ldl: 2.7, hdl: 1.2, measuredAt: atDaysAgo(18, 9, 10), note: '年度记录', status: { key: 'ok', label: '合适' } }
    ],
    uric: [
      { id: 'demo-u1', value: 356, measuredAt: atDaysAgo(3, 8, 20), note: '晨起记录', status: { key: 'ok', label: '达标' } },
      { id: 'demo-u2', value: 382, measuredAt: atDaysAgo(10, 8, 5), note: '', status: { key: 'ok', label: '达标' } }
    ]
  };
  return records[metric] || [];
}

function demoStats(metric, range) {
  const count = range === 7 ? 7 : range === 30 ? 18 : 32;
  const values = {
    glucose: [6.1, 6.8, 5.9, 7.2, 6.5, 6.3, 6.2],
    bp: [126, 130, 128, 132, 125, 129, 128],
    lipid: [4.8, 4.7, 4.6],
    uric: [372, 368, 361, 356]
  }[metric] || [];
  const points = values.map((value, index) => ({
    date: atDaysAgo(values.length - index - 1, 8).slice(0, 10),
    value,
    valueMmol: metric === 'glucose' ? value : undefined,
    sbp: metric === 'bp' ? value : undefined
  }));

  if (metric === 'glucose') return { n: count, avg: 6.4, max: 7.2, min: 5.9, series: { points } };
  if (metric === 'bp') return { n: count, avgSbp: 128, avgDbp: 79, okRate: 0.86, series: { points } };
  if (metric === 'lipid') return { n: 3, latest: { tc: 4.6, tg: 1.3, ldl: 2.7, hdl: 1.2 }, series: { points } };
  return { n: count, latest: { value: 356 }, avg: 366, okRate: 0.91, series: { points } };
}

module.exports = { demoMe, demoOverview, demoRecords, demoStats };
