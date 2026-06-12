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
  dlow: '#D6453D',
  lo: '#4A7DDB',
  ok: '#19A77E',
  hi: '#E8833A',
  dhigh: '#D6453D'
};

function baseOption() {
  return {
    textStyle: { fontFamily: FONT },
    animationDuration: 360,
    grid: { left: 6, right: 10, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: 'time',
      axisLabel: { fontSize: 9.5, color: '#8C9C96' },
      axisLine: { lineStyle: { color: '#E4EAE7' } }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { fontSize: 10, color: '#8C9C96' },
      splitLine: { lineStyle: { color: '#ECF1EE' } },
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
        lineStyle: { width: 2, color: '#0E7E6B' },
        data: points.map((point) => ({
          value: [new Date(point.t).getTime(), point.v],
          itemStyle: { color: point.status ? STATUS_COLOR[point.status] : '#19A77E' }
        })),
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(25,167,126,.09)' },
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
        lineStyle: { width: 2, color: '#3E63C9' },
        data: points.map((point) => [new Date(point.t).getTime(), point.sbp])
      },
      {
        name: 'DBP',
        type: 'line',
        smooth: 0.25,
        symbolSize: 6,
        lineStyle: { width: 1.5, color: 'rgba(62,99,201,.6)' },
        data: points.map((point) => [new Date(point.t).getTime(), point.dbp]),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#A9BAB3' },
          data: [{ yAxis: 135 }, { yAxis: 85 }]
        }
      }
    ]
  };
}

export function buildLipidTrendOption(points: SeriesPoint[]) {
  const series = [
    ['TC', 'tc', '#C77B33'],
    ['TG', 'tg', '#E0A260'],
    ['LDL-C', 'ldl', '#8F5D24'],
    ['HDL-C', 'hdl', '#0E7E6B']
  ] as const;
  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { fontSize: 10, color: '#7A8A85' } },
    series: series.map(([name, key, color]) => ({
      name,
      type: 'line',
      smooth: 0.2,
      symbolSize: 7,
      lineStyle: { width: 2, color },
      data: points.filter((point) => point[key] != null).map((point) => [new Date(point.t).getTime(), point[key]]),
      markLine:
        key === 'ldl'
          ? { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: '#A9BAB3' }, data: [{ yAxis: 3.4 }] }
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
        lineStyle: { width: 2, color: '#7A5BBF' },
        data: points.map((point) => ({
          value: [new Date(point.t).getTime(), point.v],
          itemStyle: { color: point.status ? STATUS_COLOR[point.status] : '#7A5BBF' }
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#A9BAB3' },
          data: [{ yAxis: threshold }, { yAxis: 540, lineStyle: { color: '#D6453D', type: 'dashed' } }]
        }
      }
    ]
  };
}
