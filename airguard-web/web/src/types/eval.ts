export type TrendLabel = 'steigend' | 'fallend' | 'stabil' | 'variabel';

export type EvalStatus = 'Ausgezeichnet' | 'Gut' | 'Okay' | 'Schwach';

export interface EvalSensor {
  value: number;
  score: number;
  trend: TrendLabel;
  slopePerMin: number;
  r2: number;
  advice: string[];
}

export interface EvalResponse {
  overall: number;
  status: EvalStatus;
  highlights: string[];
  sensors: Partial<Record<'co2' | 'pm25' | 'tvoc' | 'temp' | 'rh', EvalSensor>>;
}
