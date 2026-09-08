const shanghai = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function shanghaiParts(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const part of shanghai.formatToParts(date)) parts[part.type] = part.value;
  const { year, month, day, hour, minute } = parts;
  if (!year || !month || !day || !hour || !minute) return null;
  return { year, month, day, hour, minute };
}

/** 北京时间 'YYYY-MM-DD HH:mm'；传入 { year: false } 时为 'MM-DD HH:mm'。空值返回 ''。 */
export function formatDateTime(iso: string | null | undefined, options: { year?: boolean } = {}) {
  const p = shanghaiParts(iso);
  if (!p) return '';
  const date = options.year === false ? `${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day}`;
  return `${date} ${p.hour}:${p.minute}`;
}

/** 北京时间 'YYYY-MM-DD'。空值返回 ''。 */
export function formatDate(iso: string | null | undefined) {
  const p = shanghaiParts(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}
