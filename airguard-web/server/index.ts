import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import process from 'node:process';
import express, { NextFunction, Request, Response as ExpressResponse } from 'express';
import compression from 'compression';
import helmet from 'helmet';

import { evaluate, RawSeries } from './aiEval';

const METRICS = [
  { key: 'CO2', label: 'CO₂', unit: 'ppm', decimals: 0 },
  { key: 'PM1.0', label: 'PM1.0', unit: 'µg/m³', decimals: 1 },
  { key: 'PM2.5', label: 'PM2.5', unit: 'µg/m³', decimals: 1 },
  { key: 'PM10', label: 'PM10', unit: 'µg/m³', decimals: 1 },
  {
    key: 'Temperatur',
    label: 'Temperatur',
    unit: '°C',
    decimals: 1,
    promName: 'temperatur__bme_kalibriert_'
  },
  { key: 'rel. Feuchte', label: 'rel. Feuchte', unit: '%', decimals: 1 },
  { key: 'Luftdruck', label: 'Luftdruck', unit: 'hPa', decimals: 1 },
  { key: 'TVOC', label: 'TVOC', unit: 'ppb', decimals: 0 },
  { key: 'Lux', label: 'Lux', unit: 'lx', decimals: 0 },
  { key: 'Farbtemperatur', label: 'Farbtemperatur', unit: 'K', decimals: 0 }
] as const;

const METRIC_LOOKUP = new Map<string, (typeof METRICS)[number]>();
for (const metric of METRICS) {
  METRIC_LOOKUP.set(metric.key, metric);
  if (metric.promName && metric.promName !== metric.key) {
    METRIC_LOOKUP.set(metric.promName, metric);
  }
}

const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 8088;
const PROM_URL = (process.env.PROM_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '');
const PROM_TIMEOUT_MS = Number.parseInt(process.env.PROM_TIMEOUT_MS ?? '', 10) || 8000;
const MAX_RANGE_SECONDS = Number.parseInt(process.env.MAX_RANGE_SECONDS ?? '', 10) || 30 * 24 * 60 * 60;
const DATA_24H_PATH = '/opt/airguard/data_24h.json';
const WEB_DIST_DIR = path.join(__dirname, '..', 'dist', 'web');
const LEGACY_PUBLIC_DIR = path.join(__dirname, '..', 'public');

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"]
} as const;

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const pushSubscriptions = new Map<string, unknown>();

app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives
    }
  })
);
app.use(compression());
app.use(express.json({ limit: '64kb' }));

app.use(
  '/lib',
  express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist'), {
    fallthrough: true,
    immutable: true,
    maxAge: '365d'
  })
);

app.use(
  '/lib',
  express.static(path.join(__dirname, '..', 'node_modules', 'chartjs-adapter-date-fns', 'dist'), {
    fallthrough: true,
    immutable: true,
    maxAge: '365d'
  })
);

if (existsSync(WEB_DIST_DIR)) {
  app.use(
    express.static(WEB_DIST_DIR, {
      extensions: ['html'],
      maxAge: '5m',
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    })
  );
}

app.use(
  express.static(LEGACY_PUBLIC_DIR, {
    extensions: ['html'],
    maxAge: '5m',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  })
);

app.get(['/', '/dashboard', '/dashboard/'], (req, res) => {
  if (existsSync(path.join(WEB_DIST_DIR, 'index.html'))) {
    res.sendFile(path.join(WEB_DIST_DIR, 'index.html'));
    return;
  }
  res.sendFile(path.join(LEGACY_PUBLIC_DIR, 'index.html'));
});

app.post('/push/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || typeof subscription !== 'object') {
    return sendJSON(res, { ok: false, error: 'Ungültiges Subscription-Objekt' }, 400);
  }

  const endpoint = typeof (subscription as { endpoint?: string }).endpoint === 'string'
    ? (subscription as { endpoint: string }).endpoint
    : null;
  if (!endpoint) {
    return sendJSON(res, { ok: false, error: 'Subscription ohne Endpoint' }, 400);
  }

  pushSubscriptions.set(endpoint, subscription);

  sendJSON(res, { ok: true, message: 'Subscription gespeichert', count: pushSubscriptions.size });
});

app.post('/push/test', (req, res) => {
  const list = Array.from(pushSubscriptions.values());
  sendJSON(
    res,
    {
      ok: true,
      message: 'Push-Teststub – Implementierung eines Push-Dienstes erforderlich.',
      subscriptions: list
    }
  );
});

app.get('/api/now', async (req, res, next) => {
  try {
    const payload = await fetchPrometheus('query', { query: 'esphome_sensor_value' });
    const results = Array.isArray(payload?.data?.result) ? payload.data.result : [];
    const data: Record<string, unknown> = {};

    for (const metric of METRICS) {
      const promName = metric.promName || metric.key;
      const match = results.find((entry: any) => entry?.metric?.name === promName);
      if (!match || !Array.isArray(match.value) || match.value.length < 2) {
        data[metric.key] = null;
        continue;
      }

      const timestampMs = Number(match.value[0]) * 1000;
      const numericValue = Number.parseFloat(match.value[1]);

      if (!Number.isFinite(timestampMs) || !Number.isFinite(numericValue)) {
        data[metric.key] = null;
        continue;
      }

      const labels = Object.fromEntries(
        Object.entries(match.metric || {}).filter(([key]) => !key.startsWith('__'))
      );

      data[metric.key] = {
        ts: timestampMs,
        value: numericValue,
        labels
      };
    }

    sendJSON(res, {
      ok: true,
      ts: Date.now(),
      data,
      meta: { metrics: METRICS }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/series', async (req, res, next) => {
  try {
    const name = String(req.query.name || '');
    const metric = METRIC_LOOKUP.get(name);

    if (!metric) {
      return sendJSON(res, { ok: false, error: `Unbekannte Metrik: ${name}` }, 400);
    }

    const rangeLiteral = req.query.range ? String(req.query.range) : '24h';
    const stepLiteral = req.query.step ? String(req.query.step) : '120s';
    const windowLiteral = req.query.win ? String(req.query.win) : '10m';

    const rangeSeconds = parseDuration(rangeLiteral);
    const stepSeconds = parseDuration(stepLiteral);
    const windowSeconds = parseDuration(windowLiteral);

    if (!Number.isFinite(rangeSeconds) || rangeSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'Ungültiger range Parameter' }, 400);
    }
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'Ungültiger step Parameter' }, 400);
    }
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'Ungültiger win Parameter' }, 400);
    }
    if (windowSeconds > rangeSeconds) {
      return sendJSON(res, { ok: false, error: 'win darf nicht größer als range sein' }, 400);
    }
    if (rangeSeconds > MAX_RANGE_SECONDS) {
      return sendJSON(
        res,
        {
          ok: false,
          error: `range ist zu groß (max. ${Math.floor(MAX_RANGE_SECONDS / 86400)} Tage)`
        },
        400
      );
    }

    const endSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = Math.max(0, endSeconds - rangeSeconds);
    const promNameEscaped = escapePromString(metric.key);
    const baseQuery = `esphome_sensor_value{name="${promNameEscaped}"}`;
    const seriesQuery = `avg_over_time(${baseQuery}[${windowLiteral}])`;

    const payload = await fetchPrometheus('query_range', {
      query: seriesQuery,
      start: String(startSeconds),
      end: String(endSeconds),
      step: stepLiteral
    });

    const series = Array.isArray(payload?.data?.result) ? payload.data.result : [];
    const primarySeries = series[0];
    const values = Array.isArray(primarySeries?.values) ? primarySeries.values : [];

    const data = values
      .map((entry: [number, string]) => {
        const [ts, rawValue] = entry;
        const x = Number(ts) * 1000;
        const y = Number.parseFloat(rawValue);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }
        return { x, y };
      })
      .filter(Boolean);

    sendJSON(res, {
      ok: true,
      ts: Date.now(),
      data,
      meta: {
        name: metric.key,
        range: rangeLiteral,
        step: stepLiteral,
        win: windowLiteral
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/ai/eval', async (req, res) => {
  try {
    const file = await fs.readFile(DATA_24H_PATH, 'utf8');
    const payload = JSON.parse(file) as RawSeries;
    const normalized = normalizeSeries(payload);
    const evaluation = evaluate(normalized);
    res.setHeader('Cache-Control', 'no-store');
    res.json(evaluation);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      res.status(503).json({ error: 'data_unavailable' });
      return;
    }
    console.error('[airguard-web] /ai/eval error:', error);
    res.status(503).json({ error: 'data_unavailable' });
  }
});

app.use('/api', (req, res) => {
  sendJSON(res, { ok: false, error: 'Nicht gefunden' }, 404);
});

app.use((err: any, req: Request, res: ExpressResponse, next: NextFunction) => {
  const status = Number.isInteger(err?.status) ? err.status : 502;
  const message =
    err?.message || 'Unerwarteter Fehler beim Zugriff auf Prometheus. Bitte Backend-Logs prüfen.';
  console.error('[airguard-web] API error:', err);
  if (req.path.startsWith('/api/')) {
    sendJSON(res, { ok: false, error: message }, status);
  } else {
    res.status(500).send('Interner Serverfehler');
  }
});

const server = app.listen(PORT, () => {
  console.log(`[airguard-web] Listening on http://127.0.0.1:${PORT} (Prometheus: ${PROM_URL})`);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function gracefulShutdown(signal: string) {
  console.log(`[airguard-web] Received ${signal}, shutting down...`);
  server.close(() => {
    console.log('[airguard-web] Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

async function fetchPrometheus(endpoint: string, params: Record<string, string>) {
  const base = new URL(PROM_URL);
  const url = new URL(`/api/v1/${endpoint}`, base);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROM_TIMEOUT_MS).unref();

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await safeJson(response);
      const details = body?.error || response.statusText;
      const error = new Error(`Prometheus-Antwort ${response.status}: ${details}`);
      (error as any).status = response.status;
      throw error;
    }

    const body = await response.json();
    if (body?.status !== 'success') {
      const error = new Error(body?.error || 'Prometheus lieferte keinen Erfolg-Status');
      (error as any).status = 502;
      throw error;
    }
    return body;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      const timeoutError = new Error(`Prometheus Anfrage dauerte länger als ${PROM_TIMEOUT_MS} ms`);
      (timeoutError as any).status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(response: any) {
  return (response as any)
    .clone()
    .json()
    .catch(() => null);
}

function sendJSON(res: ExpressResponse, payload: unknown, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
}

function parseDuration(input: string | undefined) {
  if (!input || typeof input !== 'string') {
    return Number.NaN;
  }
  const match = input.trim().match(/^(\d+)(ms|s|m|h|d|w)$/);
  if (!match) {
    return Number.NaN;
  }
  const [, value, unit] = match;
  const numeric = Number.parseInt(value, 10);
  const multiplier: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60
  };
  return numeric * multiplier[unit];
}

function escapePromString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeSeries(raw: unknown): RawSeries {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  if (Array.isArray((raw as any).series)) {
    return mapSeriesArray((raw as any).series);
  }

  if (Array.isArray(raw)) {
    return mapSeriesArray(raw as any);
  }

  if ((raw as any).data && typeof (raw as any).data === 'object') {
    return normalizeSeries((raw as any).data);
  }

  const result: RawSeries = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      result[key] = value as any;
    }
  }
  return result;
}

function mapSeriesArray(series: any[]): RawSeries {
  const result: RawSeries = {};
  for (const entry of series) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as any).name || (entry as any).metric || (entry as any).key;
    if (!name) continue;
    const samples = Array.isArray((entry as any).values)
      ? (entry as any).values
      : Array.isArray((entry as any).series)
      ? (entry as any).series
      : Array.isArray((entry as any).samples)
      ? (entry as any).samples
      : null;
    if (!samples) continue;
    result[name] = samples;
  }
  return result;
}
