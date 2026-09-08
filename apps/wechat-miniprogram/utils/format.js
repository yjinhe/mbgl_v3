function pad(value) {
  return String(value).padStart(2, '0');
}

function toDate(value) {
  return value ? new Date(value) : new Date();
}

function fmtTime(value) {
  const date = toDate(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtMD(value) {
  const date = toDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dayLabel(value) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = toDate(value);
  date.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${fmtMD(value)} ${weekdays[toDate(value).getDay()]}`;
}

function greetingAt(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function localDateLine(date = new Date()) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${fmtMD(date)} ${weekdays[date.getDay()]}`;
}

function toDateInput(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromInputs(dateValue, timeValue) {
  // Build the date from its parts so the picker values are interpreted in the
  // device's local time zone; a timezone-less ISO string is parsed as UTC.
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  const [hour, minute] = String(timeValue || '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0).toISOString();
}

module.exports = {
  dayLabel,
  fmtMD,
  fmtTime,
  greetingAt,
  localDateLine,
  toDateInput,
  toIsoFromInputs,
  toTimeInput
};
