import { meanBy } from './utils/math';

export type TrendLabel = 'steigend' | 'fallend' | 'stabil' | 'variabel';

export type RawSample =
  | { ts: number | string; value: number | string }
  | { timestamp: number | string; value: number | string }
  | { x: number | string; y: number | string }
  | [number | string, number | string];

export type RawSeries = Record<string, RawSample[] | undefined>;

export interface SensorEvaluation {
  value: number;
  score: number;
  trend: TrendLabel;
  slopePerMin: number;
  r2: number;
  advice: string[];
}

export type EvalStatus = 'Ausgezeichnet' | 'Gut' | 'Okay' | 'Schwach';

export interface EvalResponse {
  overall: number;
  status: EvalStatus;
  highlights: string[];
  sensors: Partial<Record<'co2' | 'pm25' | 'tvoc' | 'temp' | 'rh', SensorEvaluation>>;
}

interface PreparedPoint {
  ts: number;
  value: number;
}

const ALPHA = 0.3;
const WINDOW_POINTS = 60;

const SENSOR_KEYS: Record<keyof EvalResponse['sensors'], string[]> = {
  co2: ['co2', 'CO2', 'co₂'],
  pm25: ['pm25', 'PM2.5', 'pm2_5'],
  tvoc: ['tvoc', 'TVOC'],
  temp: ['temp', 'Temperatur', 'temperature'],
  rh: ['rh', 'rel. Feuchte', 'humidity']
};

const TREND_THRESHOLDS: Record<keyof EvalResponse['sensors'], number> = {
  co2: 6,
  pm25: 0.4,
  tvoc: 8,
  temp: 0.05,
  rh: 0.25
};

const SCORE_WEIGHTS: Record<keyof EvalResponse['sensors'], number> = {
  co2: 0.4,
  pm25: 0.25,
  tvoc: 0.2,
  temp: 0.075,
  rh: 0.075
};

const STATUS_BREAKPOINTS: [number, EvalStatus][] = [
  [85, 'Ausgezeichnet'],
  [70, 'Gut'],
  [50, 'Okay'],
  [0, 'Schwach']
];

export function evaluate(series: RawSeries): EvalResponse {
  const sensors: EvalResponse['sensors'] = {};
  const highlights: string[] = [];

  let weightedScore = 0;
  let totalWeight = 0;

  (Object.keys(SENSOR_KEYS) as (keyof EvalResponse['sensors'])[]).forEach((key) => {
    const rawPoints = pickSeries(series, SENSOR_KEYS[key]);
    if (!rawPoints.length) {
      return;
    }

    const prepared = preparePoints(rawPoints);
    if (prepared.length === 0) {
      return;
    }

    const value = prepared[prepared.length - 1].value;
    const emaSeries = applyEma(prepared, ALPHA);
    const regressionInput = emaSeries.slice(-WINDOW_POINTS);
    const stats = regressionInput.length >= 2 ? linearRegression(regressionInput) : null;

    const slopePerMin = stats ? stats.slope * 60000 : 0;
    const r2 = stats ? stats.r2 : 0;

    const trend = resolveTrend(key, slopePerMin, r2);
    const score = scoreSensor(key, value);
    const advice = buildAdvice(key, value, trend);

    sensors[key] = { value, score, trend, slopePerMin, r2, advice };

    const weight = SCORE_WEIGHTS[key];
    weightedScore += score * weight;
    totalWeight += weight;

    advice.forEach((item) => {
      if (highlights.length < 2 && !highlights.includes(item)) {
        highlights.push(item);
      }
    });
  });

  const overall = totalWeight > 0 ? clamp(weightedScore / totalWeight, 0, 100) : 0;
  const status = STATUS_BREAKPOINTS.find(([threshold]) => overall >= threshold)?.[1] ?? 'Schwach';

  return {
    overall,
    status,
    highlights,
    sensors
  };
}

function pickSeries(series: RawSeries, aliases: string[]): RawSample[] {
  for (const key of aliases) {
    const match = series[key];
    if (Array.isArray(match)) {
      return match;
    }
  }
  return [];
}

function preparePoints(points: RawSample[]): PreparedPoint[] {
  return points
    .map((point) => {
      let ts: number;
      let value: number;

      if (Array.isArray(point)) {
        ts = typeof point[0] === 'string' ? Date.parse(point[0]) : Number(point[0]);
        value = typeof point[1] === 'string' ? Number.parseFloat(point[1]) : Number(point[1]);
      } else if ('ts' in point) {
        ts = typeof point.ts === 'string' ? Date.parse(point.ts) : Number(point.ts);
        value = typeof point.value === 'string' ? Number.parseFloat(point.value) : Number(point.value);
      } else if ('timestamp' in point) {
        ts =
          typeof point.timestamp === 'string'
            ? Date.parse(point.timestamp)
            : Number(point.timestamp);
        value = typeof point.value === 'string' ? Number.parseFloat(point.value) : Number(point.value);
      } else if ('x' in point) {
        ts = typeof point.x === 'string' ? Date.parse(point.x) : Number(point.x);
        const raw = 'y' in point ? point.y : (point as any).value;
        value = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
      } else {
        return null;
      }

      if (!Number.isFinite(ts) || !Number.isFinite(value)) {
        return null;
      }
      return { ts, value };
    })
    .filter((entry): entry is PreparedPoint => Boolean(entry))
    .sort((a, b) => a.ts - b.ts);
}

function applyEma(points: PreparedPoint[], alpha: number): PreparedPoint[] {
  if (!points.length) {
    return [];
  }
  let current = points[0].value;
  return points.map((point) => {
    current = alpha * point.value + (1 - alpha) * current;
    return { ts: point.ts, value: current };
  });
}

interface RegressionStats {
  slope: number; // value per ms
  intercept: number;
  r2: number;
}

function linearRegression(points: PreparedPoint[]): RegressionStats {
  const n = points.length;
  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const meanX = meanBy(xs, (x) => x);
  const meanY = meanBy(ys, (y) => y);

  let numerator = 0;
  let denominator = 0;
  let totalSq = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = xs[i] - meanX;
    numerator += xDiff * (ys[i] - meanY);
    denominator += xDiff * xDiff;
    totalSq += (ys[i] - meanY) * (ys[i] - meanY);
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  let residualSq = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    residualSq += (ys[i] - predicted) * (ys[i] - predicted);
  }

  const r2 = totalSq === 0 ? 0 : 1 - residualSq / totalSq;

  return { slope, intercept, r2: clamp(r2, 0, 1) };
}

function resolveTrend(key: keyof EvalResponse['sensors'], slopePerMin: number, r2: number): TrendLabel {
  if (r2 < 0.2) {
    return 'variabel';
  }
  const threshold = TREND_THRESHOLDS[key];
  if (slopePerMin > threshold) {
    return 'steigend';
  }
  if (slopePerMin < -threshold) {
    return 'fallend';
  }
  return 'stabil';
}

function scoreSensor(key: keyof EvalResponse['sensors'], value: number): number {
  switch (key) {
    case 'co2':
      return piecewise(value, [
        [600, 100],
        [1000, 50],
        [1400, 10],
        [2000, 0]
      ]);
    case 'pm25':
      return piecewise(value, [
        [5, 100],
        [12, 90],
        [35, 15],
        [55, 0]
      ]);
    case 'tvoc':
      return piecewise(value, [
        [65, 100],
        [220, 85],
        [660, 10]
      ]);
    case 'temp': {
      const delta = Math.abs(value - 22);
      return clamp(100 - delta * 12, 0, 100);
    }
    case 'rh': {
      if (value >= 40 && value <= 55) {
        return 100;
      }
      if (value < 40) {
        return clamp(100 - (40 - value) * 5, 0, 100);
      }
      return clamp(100 - (value - 55) * 5, 0, 100);
    }
    default:
      return 0;
  }
}

function buildAdvice(
  key: keyof EvalResponse['sensors'],
  value: number,
  trend: TrendLabel
): string[] {
  switch (key) {
    case 'co2': {
      if (value >= 2000 || value >= 1500 || (value >= 1000 && trend === 'steigend')) {
        return ['Fenster 5–10 min kippen oder Querlüften'];
      }
      return [];
    }
    case 'pm25': {
      if (value > 35) {
        return ['Fenster schließen, Innenquelle prüfen', 'HEPA aktivieren'];
      }
      if (value > 12) {
        return ['Fenster schließen, Innenquelle prüfen'];
      }
      return [];
    }
    case 'tvoc': {
      if (value > 220) {
        return ['Lüften; Duft-/Reinigungsquellen reduzieren'];
      }
      return [];
    }
    case 'temp': {
      if (value < 20) {
        return ['Heizung leicht erhöhen'];
      }
      if (value > 24) {
        return ['Beschattung/Kühlung aktivieren'];
      }
      return [];
    }
    case 'rh': {
      if (value < 35) {
        return ['Luftbefeuchter niedrig'];
      }
      if (value > 60) {
        return ['Entfeuchten/mehr Lüften'];
      }
      return [];
    }
    default:
      return [];
  }
}

function piecewise(value: number, points: [number, number][]): number {
  if (!points.length) {
    return 0;
  }
  if (value <= points[0][0]) {
    return points[0][1];
  }
  for (let i = 1; i < points.length; i++) {
    const [prevX, prevY] = points[i - 1];
    const [x, y] = points[i];
    if (value <= x) {
      return lerp(prevY, y, (value - prevX) / (x - prevX));
    }
  }
  return points[points.length - 1][1];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
