const { metrics, periodNames } = require('./metrics');
const { dateParts, recordValues, seriesPoints } = require('./stats-view');

const PAGE_SIZE = 8;
const IMAGE_WIDTH = 1000;
const FOOTNOTE = '仅供个人记录与家人沟通，不作为诊疗依据。';

function buildWeeklyPages(report, options = {}) {
  const { unit = 'mmol', nickname = '', demo = false } = options;
  const from = dateParts(report.from).date;
  const to = dateParts(report.to).date;
  const groups = [];
  metrics.forEach((metric) => {
    const records = seriesPoints((report.sections || {})[metric.key]).filter((record) => {
      const date = dateParts(record.measuredAt || record.date).date;
      return date && date >= from && date <= to;
    }).slice().sort((a, b) => String(a.measuredAt || a.date).localeCompare(String(b.measuredAt || b.date)));
    const grouped = new Map();
    records.forEach((record) => {
      const key = metric.key === 'glucose' ? (record.period || 'unknown') : metric.key;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(record);
    });
    const periodOrder = ['fasting', 'post_meal_1h', 'post_meal_2h'];
    const ordered = Array.from(grouped.entries()).sort(([a], [b]) => {
      const ai = periodOrder.includes(a) ? periodOrder.indexOf(a) : periodOrder.length;
      const bi = periodOrder.includes(b) ? periodOrder.indexOf(b) : periodOrder.length;
      return ai - bi;
    });
    ordered.forEach(([key, items]) => {
      groups.push({
        title: `${metric.name}${metric.key === 'glucose' ? ` · ${periodNames[key] || '未标时段'}` : ''}`,
        metric: metric.key,
        color: metric.color,
        rows: items.map((record, index) => {
          const date = dateParts(record.measuredAt || record.date);
          return {
            id: record.id || `${metric.key}:${key}:${index}`,
            dateText: date.date.replace(/-/g, '/'),
            timeText: date.time,
            periodText: periodNames[record.period] || (metric.key === 'lipid' ? '化验' : ''),
            lines: recordValues(metric.key, record, unit)
          };
        })
      });
    });
  });
  const totalRecords = groups.reduce((total, group) => total + group.rows.length, 0);
  const pages = [];
  groups.forEach((group) => {
    for (let index = 0; index < group.rows.length; index += PAGE_SIZE) {
      const rows = group.rows.slice(index, index + PAGE_SIZE);
      const rowHeight = group.metric === 'lipid' ? 176 : 128;
      pages.push({
        title: '近7天健康记录', nickname, demo,
        rangeText: `${from.replace(/-/g, '/')} — ${to.replace(/-/g, '/')}`,
        sectionTitle: group.title, metric: group.metric, color: group.color,
        groupCount: group.rows.length, totalRecords, rows, rowHeight,
        width: IMAGE_WIDTH, height: 430 + rows.length * rowHeight + 144,
        footnote: FOOTNOTE
      });
    }
  });
  pages.forEach((page, index) => { page.pageNumber = index + 1; page.pageCount = pages.length; });
  return { pages, totalRecords, rangeText: `${from.replace(/-/g, '/')} — ${to.replace(/-/g, '/')}` };
}

function drawWeeklyPage(ctx, page) {
  const text = (value, x, y, size, color = '#16302B') => {
    ctx.setFontSize(size);
    ctx.setFillStyle(color);
    ctx.fillText(String(value), x, y);
  };
  const fittingText = (value, x, y, size, maxWidth, color = '#16302B') => {
    let fontSize = size;
    ctx.setFontSize(fontSize);
    while (fontSize > 24 && ctx.measureText(String(value)).width > maxWidth) {
      fontSize -= 1;
      ctx.setFontSize(fontSize);
    }
    text(value, x, y, fontSize, color);
  };
  ctx.setFillStyle('#F2F5F3');
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.setFillStyle(page.color);
  ctx.fillRect(0, 0, page.width, 16);
  text(page.demo ? '小糖本 · 演示数据' : '小糖本 · 个人记录', 56, 76, 34, page.color);
  text(page.title, 56, 146, 52);
  fittingText(page.nickname || '我的健康记录', 56, 202, 32, 888, '#41534E');
  text(page.rangeText, 56, 252, 34);
  text(`北京时间 · 共 ${page.totalRecords} 条记录`, 56, 298, 34, '#41534E');
  ctx.setFillStyle('#FFFFFF');
  ctx.fillRect(32, 330, 936, page.rows.length * page.rowHeight + 96);
  text(page.sectionTitle, 56, 384, 36, page.color);
  text(`本组 ${page.groupCount} 条 · 本页 ${page.rows.length} 条${page.metric === 'lipid' ? ' · mmol/L' : ''}`, 56, 422, 32, '#41534E');
  page.rows.forEach((row, index) => {
    const top = 436 + index * page.rowHeight;
    fittingText(`${row.dateText} ${row.timeText}${page.metric === 'bp' && row.periodText ? `  ${row.periodText}` : ''}`, 56, top + 30, 36, 888, '#41534E');
    row.lines.forEach((line, lineIndex) => fittingText(line, 56, top + 86 + lineIndex * 60, 52, 888));
    if (index < page.rows.length - 1) {
      ctx.setFillStyle('#E4EAE7');
      ctx.fillRect(56, top + page.rowHeight - 5, 888, 1);
    }
  });
  text(`第 ${page.pageNumber} / ${page.pageCount} 张${page.pageCount > 1 ? ' · 请留意其余图片' : ''}`, 56, page.height - 88, 34, page.color);
  text(page.footnote, 56, page.height - 40, 32, '#41534E');
}

module.exports = { buildWeeklyPages, drawWeeklyPage, PAGE_SIZE };
