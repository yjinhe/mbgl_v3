import type { StatusKey } from './types.js';

export interface SeriesPoint {
  t: Date | string;
  v?: number;
  sbp?: number;
  dbp?: number;
  tc?: number | null;
  tg?: number | null;
  ldl?: number | null;
  hdl?: number | null;
  status?: StatusKey;
}

const FONT =
  '-apple-system,BlinkMacSystemFont,"PingFang SC","MiSans","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif';

const STATUS_COLOR: Record<StatusKey, string> = {
  dlow: 'var(--danger)',
  lo: 'var(--lo)',
  ok: 'var(--ok)',
  hi: 'var(--hi)',
  dhigh: 'var(--danger)'
};

function baseOption() {
  return {
    textStyle: { fontFamily: FONT },
    animationDuration: 360,
    grid: { left: 6, right: 10, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: 'time',
      axisLabel: { fontSize: 9.5, color: 'var(--ink-3)' },
      axisLine: { lineStyle: { color: 'var(--line)' } }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { fontSize: 10, color: 'var(--ink-3)' },
      splitLine: { lineStyle: { color: 'var(--line)' } },
      axisLine: { show: false },
      axisTick: { show: false }
    }
  };
}

export function buildGlucoseTrendOption(points: SeriesPoint[], target = { fastingLow: 4.4, postMealHigh: 10.0 }) {
  return {
    ...baseOption(),
    series: [
      {
        type: 'line',
        smooth: 0.25,
        symbolSize: 7,
        lineStyle: { width: 2, color: 'var(--m-glucose)' },
        data: points.map((point) => ({
          value: [new Date(point.t).getTime(), point.v],
          itemStyle: { color: point.status ? STATUS_COLOR[point.status] : 'var(--ok)' }
        })),
        markArea: {
          silent: true,
          itemStyle: { color: 'var(--ok-soft)' },
          data: [[{ yAxis: target.fastingLow }, { yAxis: target.postMealHigh }]]
        }
      }
    ]
  };
}

export function buildBpTrendOption(points: SeriesPoint[]) {
  return {
    ...baseOption(),
    series: [
      {
        name: 'SBP',
        type: 'line',
        smooth: 0.25,
        symbolSize: 7,
        lineStyle: { width: 2, color: 'var(--m-bp)' },
        data: points.map((point) => [new Date(point.t).getTime(), point.sbp])
      },
      {
        name: 'DBP',
        type: 'line',
        smooth: 0.25,
        symbolSize: 6,
        lineStyle: { width: 1.5, color: 'var(--m-bp)' },
        data: points.map((point) => [new Date(point.t).getTime(), point.dbp]),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: 'var(--ink-3)' },
          data: [{ yAxis: 135 }, { yAxis: 85 }]
        }
      }
    ]
  };
}

export function buildLipidTrendOption(points: SeriesPoint[]) {
  const series = [
    ['TC', 'tc', 'var(--m-lipid)'],
    ['TG', 'tg', 'var(--hi)'],
    ['LDL-C', 'ldl', 'var(--m-lipid)'],
    ['HDL-C', 'hdl', 'var(--m-glucose)']
  ] as const;
  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { fontSize: 10, color: 'var(--ink-3)' } },
    series: series.map(([name, key, color]) => ({
      name,
      type: 'line',
      smooth: 0.2,
      symbolSize: 7,
      lineStyle: { width: 2, color },
      data: points.filter((point) => point[key] != null).map((point) => [new Date(point.t).getTime(), point[key]]),
      markLine:
        key === 'ldl'
          ? { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: 'var(--ink-3)' }, data: [{ yAxis: 3.4 }] }
          : undefined
    }))
  };
}

export function buildUricTrendOption(points: SeriesPoint[], threshold: number) {
  return {
    ...baseOption(),
    series: [
      {
        type: 'line',
        smooth: 0.25,
        symbolSize: 7,
        lineStyle: { width: 2, color: 'var(--m-uric)' },
        data: points.map((point) => ({
          value: [new Date(point.t).getTime(), point.v],
          itemStyle: { color: point.status ? STATUS_COLOR[point.status] : 'var(--m-uric)' }
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: 'var(--ink-3)' },
          data: [{ yAxis: threshold }, { yAxis: 540, lineStyle: { color: 'var(--danger)', type: 'dashed' } }]
        }
      }
    ]
  };
}
