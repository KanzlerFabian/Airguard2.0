'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const DataStore = require('./data-store');

if (typeof fetch !== 'function') {
  throw new Error('Global fetch API not available. Please run with Node.js v18 or newer.');
}

const METRICS = [
  {
    key: 'CO2',
    label: 'CO\u2082',
    unit: 'ppm',
    decimals: 0,
    // MUSS dem Prometheus-Label name="CO2" entsprechen:
    promNames: ['CO2', 'co2_ppm', 'co2'],
    queryNames: ['CO\u2082', 'CO2', 'co2', 'co2_ppm'],
    slug: 'co2'
  },
  {
    key: 'PM1.0',
    label: 'PM1',
    unit: 'µg/m³',
    decimals: 1,
    promNames: ['PM1.0', 'PM1', 'pm1', 'pm1.0'],
    queryNames: ['PM1', 'PM1.0', 'pm1'],
    slug: 'pm1'
  },
  {
    key: 'PM2.5',
    label: 'PM2.5',
    unit: 'µg/m³',
    decimals: 1,
    promNames: ['PM2.5', 'pm25', 'pm2_5', 'pm2.5'],
    queryNames: ['PM2.5', 'pm2.5', 'pm25'],
    slug: 'pm25'
  },
  {
    key: 'PM10',
    label: 'PM10',
    unit: 'µg/m³',
    decimals: 1,
    promNames: ['PM10', 'pm10'],
    queryNames: ['PM10', 'pm10'],
    slug: 'pm10'
  },
  {
    key: 'Temperatur',
    label: 'Temperatur',
    unit: '°C',
    decimals: 1,
    promNames: ['Temperatur', 'temp_final', 'temperatur', 'temperature', 'temp'],
    queryNames: ['Temperatur', 'temperatur', 'temperature', 'temp', 'temp_final'],
    slug: 'temp_final'
  },
  {
    key: 'rel. Feuchte',
    label: 'rel. Feuchte',
    unit: '%',
    decimals: 1,
    promNames: ['rel. Feuchte', 'humidity', 'rel_feuchte'],
    queryNames: ['rel. Feuchte', 'relfeuchte', 'luftfeuchte', 'humidity'],
    slug: 'humidity'
  },
  {
    key: 'Lux',
    label: 'Lux',
    unit: 'lx',
    decimals: 0,
    promNames: ['Lux', 'lux', 'beleuchtungsstaerke'],
    queryNames: ['Lux', 'lux'],
    slug: 'lux'
  },
  {
    key: 'Farbtemperatur',
    label: 'CCT',
    unit: 'K',
    decimals: 0,
    promNames: ['Farbtemperatur', 'CCT', 'cct_k', 'cct', 'farbtemperatur'],
    queryNames: ['CCT', 'Farbtemperatur', 'cct', 'cct_k'],
    slug: 'cct_k'
  },
  {
    key: 'Luftdruck',
    label: 'Luftdruck',
    unit: 'hPa',
    decimals: 1,
    promNames: ['Luftdruck', 'pressure_hpa', 'pressure', 'luftdruck'],
    queryNames: ['Luftdruck', 'druck', 'pressure_hpa'],
    slug: 'pressure_hpa'
  },
  {
    key: 'TVOC',
    label: 'TVOC',
    unit: 'ppb',
    decimals: 0,
    promNames: ['TVOC', 'tvoc'],
    queryNames: ['TVOC', 'voc', 'tvoc'],
    slug: 'tvoc'
  }
];

const QUERY_LOOKUP = new Map();
const KNOWN_QUERY_KEYS = new Set();
const SERIES_PROM_NAME_CACHE = new Map();

for (const metric of METRICS) {
  const promList = Array.isArray(metric.promNames) && metric.promNames.length > 0 ? metric.promNames : [metric.key];
  metric.promNames = promList;
  metric.promQueryName = promList[0];

  const aliases = new Set([
    metric.key,
    metric.label,
    metric.slug,
    metric.promQueryName,
    ...(metric.promNames || []),
    ...(metric.queryNames || [])
  ]);
  for (const alias of aliases) {
    if (!alias) continue;
    const normalized = normalizeQueryName(alias);
    if (!normalized) continue;
    QUERY_LOOKUP.set(normalized, metric);
  }

  const slug = metric.slug || normalizeQueryName(metric.key);
  if (slug) {
    metric.slug = slug;
    KNOWN_QUERY_KEYS.add(slug);
  }
}


const PORT = Number.parseInt(process.env.PORT || '', 10) || 8088;
const PROM_URL = (process.env.PROM_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '');
const PROM_TIMEOUT_MS = Number.parseInt(process.env.PROM_TIMEOUT_MS || '', 10) || 8000;
const MAX_RANGE_SECONDS = Number.parseInt(process.env.MAX_RANGE_SECONDS || '', 10) || 30 * 24 * 60 * 60;
const isProduction = process.env.NODE_ENV === 'production';
const RANGE_PRESETS = {
  '24h': {
    literal: '24h',
    seconds: 24 * 60 * 60,
    step: { min: 120, max: 600, default: 120 },
    window: { default: 600, minMultiplier: 2, max: 2400 }
  },
  '7d': {
    literal: '7d',
    seconds: 7 * 24 * 60 * 60,
    step: { min: 600, max: 900, default: 900 },
    window: { default: 2700, minMultiplier: 2, max: 7200 }
  },
  '30d': {
    literal: '30d',
    seconds: 30 * 24 * 60 * 60,
    step: { min: 1800, max: 3600, default: 1800 },
    window: { default: 7200, minMultiplier: 2, max: 14400 }
  }
};
const CACHE_FLAG = process.env.AIRGUARD_ENABLE_CACHE || process.env.AIRGUARD_CACHE || '';
const CACHE_DIR_ENV = typeof process.env.AIRGUARD_CACHE_DIR === 'string' ? process.env.AIRGUARD_CACHE_DIR.trim() : '';
const CACHE_ENABLED = envEnabled(CACHE_FLAG) || Boolean(CACHE_DIR_ENV);
const CACHE_DIR = CACHE_ENABLED ? CACHE_DIR_ENV || '/var/cache/airguard' : '';
let cachePath = null;

if (CACHE_DIR) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    cachePath = path.join(CACHE_DIR, 'metrics.json');
  } catch (error) {
    if (error?.code === 'EACCES') {
      console.warn(`[airguard-web] Cache disabled (no permission for ${CACHE_DIR}):`, error.message);
    } else {
      console.warn(`[airguard-web] Failed to prepare cache directory ${CACHE_DIR}:`, error);
    }
    cachePath = null;
  }
}

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"]
};

if (!isProduction) {
  cspDirectives.scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
}

if (cachePath) {
  console.log(`[airguard-web] Using cache directory: ${CACHE_DIR}`);
} else {
  console.log('[airguard-web] Disk cache disabled – running without persistent storage.');
}

const dataStore = new DataStore(cachePath);
dataStore.ready.catch((error) => {
  console.warn('[airguard-web] Failed to initialise cache store:', error);
});

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const pushSubscriptions = new Map();

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
  express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist'), {
    fallthrough: true,
    immutable: true,
    maxAge: '365d'
  })
);

app.use(
  '/lib',
  express.static(path.join(__dirname, 'node_modules', 'chartjs-adapter-date-fns', 'dist'), {
    fallthrough: true,
    immutable: true,
    maxAge: '365d'
  })
);

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: '5m',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  })
);

app.get(['/', '/dashboard', '/dashboard/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/push/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || typeof subscription !== 'object') {
    return sendJSON(res, { ok: false, error: 'Ungültiges Subscription-Objekt' }, 400);
  }

  const endpoint = typeof subscription.endpoint === 'string' ? subscription.endpoint : null;
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
    await dataStore.ready;
    const payload = await fetchPrometheus('query', { query: 'esphome_sensor_value' });
    const results = Array.isArray(payload?.data?.result) ? payload.data.result : [];
    const data = {};

    for (const metric of METRICS) {
      const match = results.find((entry) => {
        const name = typeof entry?.metric?.name === 'string' ? entry.metric.name : '';
        if (!name) return false;
        const normalized = normalizeQueryName(name);
        return metric.promNames.some((candidate) => {
          if (!candidate) return false;
          if (candidate === name) return true;
          return normalizeQueryName(candidate) === normalized;
        });
      });
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

    const responsePayload = {
      ok: true,
      ts: Date.now(),
      data,
      meta: { metrics: METRICS }
    };

    dataStore
      .recordSnapshot({
        ts: responsePayload.ts,
        data: responsePayload.data,
        meta: responsePayload.meta
      })
      .catch((error) => {
        console.warn('[airguard-web] Failed to cache snapshot:', error);
      });

    sendJSON(res, responsePayload);
  } catch (error) {
    try {
      const cached = dataStore.latestSnapshot();
      if (cached) {
        sendJSON(res, { ok: true, cached: true, ts: cached.ts, data: cached.data, meta: cached.meta });
        return;
      }
    } catch (cacheError) {
      console.warn('[airguard-web] Failed to serve cached snapshot:', cacheError);
    }
    next(error);
  }
});

app.get('/api/series', async (req, res, next) => {
  let metric;
  let rangeLiteral;
  let stepLiteral;
  let windowLiteral;
  let metricKey;
  let usedPromName;
  try {
    await dataStore.ready;
    const nameLiteral = String(req.query.name || '');
    metric = QUERY_LOOKUP.get(normalizeQueryName(nameLiteral));

    if (!metric) {
      return sendJSON(
        res,
        { ok: false, error: 'unknown_metric', known: Array.from(KNOWN_QUERY_KEYS).sort() },
        400
      );
    }

    metricKey = metric.slug || metric.key;
    rangeLiteral = req.query.range ? String(req.query.range) : '24h';
    stepLiteral = req.query.step ? String(req.query.step) : undefined;
    windowLiteral = req.query.win ? String(req.query.win) : undefined;

    const normalizedParams = normalizeSeriesParams(rangeLiteral, stepLiteral, windowLiteral);
    rangeLiteral = normalizedParams.rangeLiteral;
    stepLiteral = normalizedParams.stepLiteral;
    windowLiteral = normalizedParams.windowLiteral;

    const { rangeSeconds, stepSeconds, windowSeconds } = normalizedParams;
    if (!Number.isFinite(rangeSeconds) || rangeSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'invalid_range' }, 400);
    }
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'invalid_step' }, 400);
    }
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'invalid_window' }, 400);
    }

    const endSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = Math.max(0, endSeconds - rangeSeconds);
    const candidates = buildPromNameCandidates(metric, nameLiteral, metricKey);
    const attempts = candidates.length > 0 ? candidates : [metric.promQueryName || metric.key];
    let data = [];
    let firstCandidate = attempts[0];
    for (const candidate of attempts) {
      const result = await queryPrometheusSeries(candidate, windowLiteral, stepLiteral, startSeconds, endSeconds);
      if (!usedPromName) {
        usedPromName = candidate;
        data = result;
      }
      if (Array.isArray(result) && result.length > 0) {
        usedPromName = candidate;
        data = result;
        break;
      }
    }

    if (!usedPromName) {
      usedPromName = firstCandidate || metric.promQueryName || metric.key;
    }

    if (!Array.isArray(data)) {
      data = [];
    }

    if (data.length === 0 && metricKey) {
      const cached = dataStore.findSeries(metricKey, {
        range: rangeLiteral,
        step: stepLiteral,
        win: windowLiteral
      });
      if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
        sendJSON(res, {
          ok: true,
          cached: true,
          ts: cached.ts || Date.now(),
          data: cached.data,
          meta: {
            name: metric.key,
            range: rangeLiteral,
            step: stepLiteral,
            win: windowLiteral,
            promName: cached.meta?.promName || usedPromName
          }
        });
        return;
      }
    }

    const responsePayload = {
      ok: true,
      ts: Date.now(),
      data,
      meta: {
        name: metric.key,
        range: rangeLiteral,
        step: stepLiteral,
        win: windowLiteral,
        promName: usedPromName
      }
    };

    if (Array.isArray(data) && data.length > 0 && metricKey) {
      SERIES_PROM_NAME_CACHE.set(metricKey, usedPromName);
      dataStore
        .recordSeries(metricKey, { range: rangeLiteral, step: stepLiteral, win: windowLiteral }, responsePayload)
        .catch((error) => {
          console.warn('[airguard-web] Failed to cache series:', error);
        });
    }

    sendJSON(res, responsePayload);
  } catch (error) {
    if (metric && rangeLiteral && stepLiteral && windowLiteral) {
      try {
        const cached = dataStore.findSeries(metric.slug || metric.key, {
          range: rangeLiteral,
          step: stepLiteral,
          win: windowLiteral
        });
        if (cached) {
          sendJSON(res, {
            ok: true,
            cached: true,
            ts: cached.ts || Date.now(),
            data: Array.isArray(cached.data) ? cached.data : [],
            meta:
              cached.meta && typeof cached.meta === 'object'
                ? { ...cached.meta }
                : {
                    name: metric.key,
                    range: rangeLiteral,
                    step: stepLiteral,
                    win: windowLiteral,
                    promName: usedPromName
                  }
          });
          return;
        }
      } catch (cacheError) {
        console.warn('[airguard-web] Failed to serve cached series:', cacheError);
      }
    }
    next(error);
  }
});

app.use('/api', (req, res) => {
  sendJSON(res, { ok: false, error: 'Nicht gefunden' }, 404);
});

app.use((err, req, res, next) => {
  const status = Number.isInteger(err?.status) ? err.status : 502;
  const code = typeof err?.code === 'string' && err.code.trim().length
    ? err.code.trim()
    : status === 502
      ? 'backend_unreachable'
      : 'internal_error';
  const message =
    err?.message ||
    (status === 502
      ? 'Backend derzeit nicht erreichbar.'
      : 'Unerwarteter Fehler beim Zugriff auf Prometheus. Bitte Backend-Logs pr\u00fcfen.');
  const payload = { ok: false, error: code };
  if (!isProduction && message && message !== code) {
    payload.message = message;
  }
  if (err?.meta && typeof err.meta === 'object') {
    payload.meta = err.meta;
  }
  console.error('[airguard-web] API error:', err);
  if (req.path.startsWith('/api/')) {
    sendJSON(res, payload, status);
  } else {
    res.status(500).send('Interner Serverfehler');
  }
});

let server = null;

function startServer(targetPort, allowRetry = true) {
  const instance = app
    .listen(targetPort, () => {
      const address = instance.address();
      const actualPort = typeof address === 'object' && address ? address.port : targetPort;
      console.log(
        `[airguard-web] Listening on http://127.0.0.1:${actualPort} (Prometheus: ${PROM_URL})`
      );
    })
    .on('error', (error) => {
      if (error?.code === 'EADDRINUSE' && allowRetry) {
        try {
          instance.close();
        } catch (closeError) {
          console.warn('[airguard-web] Failed to close server after EADDRINUSE:', closeError);
        }
        console.warn(
          `[airguard-web] Port ${targetPort} already in use, retrying on a random free port...`
        );
        startServer(0, false);
        return;
      }
      console.error('[airguard-web] Failed to start server:', error);
      process.exitCode = 1;
    });

  server = instance;
  return instance;
}

startServer(PORT);

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function gracefulShutdown(signal) {
  console.log(`[airguard-web] Received ${signal}, shutting down...`);
  if (server && typeof server.close === 'function') {
    server.close(() => {
      console.log('[airguard-web] Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  } else {
    process.exit(0);
  }
}

async function fetchPrometheus(endpoint, params) {
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
      const details = body?.error || response.statusText || 'Prometheus request failed';
      const status = response.status >= 500 ? 502 : response.status;
      const code = status === 502 ? 'backend_unreachable' : 'prometheus_error';
      throw createHttpError(status, code, details, { endpoint, params, status: response.status });
    }

    const body = await response
      .json()
      .catch(() => ({ status: 'error', error: 'Prometheus lieferte keine g\u00fcltige JSON-Antwort' }));
    if (body?.status !== 'success') {
      const message = body?.error || 'Prometheus lieferte keinen Erfolg-Status';
      throw createHttpError(502, 'prometheus_error', message, { endpoint, params });
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createHttpError(
        502,
        'backend_unreachable',
        `Prometheus Anfrage dauerte l\u00e4nger als ${PROM_TIMEOUT_MS} ms`,
        { endpoint, params }
      );
    }
    if (!error?.status) {
      throw createHttpError(502, 'backend_unreachable', 'Prometheus nicht erreichbar', {
        endpoint,
        params
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(response) {
  return response
    .clone()
    .json()
    .catch(() => null);
}

function sendJSON(res, payload, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
}

function parseDuration(input) {
  if (!input || typeof input !== 'string') {
    return Number.NaN;
  }
  const match = input.trim().match(/^(\d+)(ms|s|m|h|d|w)$/);
  if (!match) {
    return Number.NaN;
  }
  const [, value, unit] = match;
  const numeric = Number.parseInt(value, 10);
  const multiplier = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60
  }[unit];
  return numeric * multiplier;
}

function normalizeSeriesParams(rangeLiteral, stepLiteral, windowLiteral) {
  const rangeKey = resolveRangeKey(rangeLiteral);
  const preset = RANGE_PRESETS[rangeKey] || RANGE_PRESETS['24h'];
  let rangeSeconds = parseDuration(rangeLiteral);
  if (!Number.isFinite(rangeSeconds) || rangeSeconds <= 0) {
    rangeSeconds = preset.seconds;
  }
  rangeSeconds = Math.min(rangeSeconds, preset.seconds, MAX_RANGE_SECONDS);
  let stepSeconds = parseDuration(stepLiteral);
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    stepSeconds = preset.step.default;
  }
  stepSeconds = clamp(stepSeconds, preset.step.min, preset.step.max);
  let windowSeconds = parseDuration(windowLiteral);
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    windowSeconds = preset.window.default;
  }
  const minWindow = Math.max(
    preset.window.default,
    Math.ceil(stepSeconds * (preset.window.minMultiplier || 2))
  );
  windowSeconds = Math.max(windowSeconds, minWindow);
  if (Number.isFinite(preset.window.max)) {
    windowSeconds = Math.min(windowSeconds, preset.window.max);
  }

  return {
    rangeKey,
    rangeLiteral: preset.literal,
    rangeSeconds,
    stepSeconds,
    stepLiteral: durationLiteralFromSeconds(stepSeconds),
    windowSeconds,
    windowLiteral: durationLiteralFromSeconds(windowSeconds)
  };
}

function resolveRangeKey(value) {
  const literal = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (literal === '7d' || literal === '7day' || literal === '7days' || literal === '1w') {
    return '7d';
  }
  if (literal === '30d' || literal === '30day' || literal === '30days' || literal === '1m') {
    return '30d';
  }
  return '24h';
}

function durationLiteralFromSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '60s';
  }
  const rounded = Math.round(seconds);
  if (rounded % (24 * 60 * 60) === 0) {
    return `${rounded / (24 * 60 * 60)}d`;
  }
  if (rounded % (60 * 60) === 0) {
    return `${rounded / (60 * 60)}h`;
  }
  if (rounded % 60 === 0) {
    return `${rounded / 60}m`;
  }
  return `${rounded}s`;
}

function clamp(value, min, max) {
  if (Number.isFinite(min) && value < min) {
    return min;
  }
  if (Number.isFinite(max) && value > max) {
    return max;
  }
  return value;
}

function escapePromString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeQueryName(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const subscripts = {
    '₀': '0',
    '₁': '1',
    '₂': '2',
    '₃': '3',
    '₄': '4',
    '₅': '5',
    '₆': '6',
    '₇': '7',
    '₈': '8',
    '₉': '9'
  };
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (char) => subscripts[char] || '')
    .replace(/(\d)\.0\b/g, '$1')
    .replace(/[^a-z0-9]/g, '');
  if (!normalized) {
    return '';
  }
  return normalized;
}

function buildPromNameCandidates(metric, requestedName, metricKey) {
  const queue = [];
  const seen = new Set();
  const push = (value) => {
    if (!value || typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeQueryName(trimmed) || trimmed.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    queue.push(trimmed);
  };

  if (metricKey && SERIES_PROM_NAME_CACHE.has(metricKey)) {
    push(SERIES_PROM_NAME_CACHE.get(metricKey));
  }
  push(requestedName);
  if (Array.isArray(metric.promNames)) {
    metric.promNames.forEach(push);
  }
  if (Array.isArray(metric.queryNames)) {
    metric.queryNames.forEach(push);
  }
  push(metric.promQueryName);
  push(metric.key);
  push(metric.label);
  push(metric.slug);

  return queue;
}

function envEnabled(value) {
  if (value == null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

function createHttpError(status, code, message, meta = {}) {
  const error = new Error(message || code || 'unexpected_error');
  error.status = status || 500;
  error.code = code || 'internal_error';
  if (meta && typeof meta === 'object') {
    error.meta = { ...meta };
  }
  return error;
}

async function queryPrometheusSeries(name, windowLiteral, stepLiteral, startSeconds, endSeconds) {
  const promName = typeof name === 'string' && name.trim().length ? name.trim() : name;
  const targetName = promName || '';
  const promNameEscaped = escapePromString(targetName || '');
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
  const startMs = startSeconds * 1000;
  const endMs = endSeconds * 1000;

  return values
    .map((entry) => {
      const [ts, rawValue] = entry;
      const x = Number(ts) * 1000;
      const y = Number.parseFloat(rawValue);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return { x, y };
    })
    .filter((point) => point && point.x >= startMs && point.x <= endMs);
}
