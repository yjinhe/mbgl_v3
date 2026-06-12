export type Metric = 'glucose' | 'bp' | 'lipid' | 'uric';
export type Unit = 'mmol' | 'mgdl';
export type Sex = 'male' | 'female' | null | undefined;
export type StatusKey = 'dlow' | 'lo' | 'ok' | 'hi' | 'dhigh';

export interface Status {
  key: StatusKey;
  label: string;
}

export interface GlucoseTarget {
  fastingLow: number;
  fastingHigh: number;
  postMealHigh: number;
}

export interface GlucosePoint {
  valueMmol: number;
  period: GlucosePeriod;
  measuredAt: Date | string;
}

export interface BpPoint {
  sbp: number;
  dbp: number;
  pulse?: number | null;
  measuredAt: Date | string;
}

export interface UricPoint {
  value: number;
  measuredAt: Date | string;
}

export interface LipidValues {
  tc?: number | null;
  tg?: number | null;
  ldl?: number | null;
  hdl?: number | null;
}

export type GlucosePeriod =
  | 'fasting'
  | 'after_breakfast'
  | 'before_lunch'
  | 'after_lunch'
  | 'random'
  | 'before_dinner'
  | 'after_dinner'
  | 'bedtime'
  | 'dawn';

export type BpPeriod = 'morning' | 'daytime' | 'evening' | 'night';
