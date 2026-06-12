export function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function localDayKey(value: Date | string): string {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shanghaiHour(value: Date | string): number {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return (hour === 24 ? 0 : hour) + minute / 60;
}

export function todayShanghaiKey(now: Date = new Date()): string {
  return localDayKey(now);
}

export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return date.toISOString().slice(0, 10);
}
