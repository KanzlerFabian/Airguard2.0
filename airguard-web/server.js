'use strict';

const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');

if (typeof fetch !== 'function') {
  throw new Error('Global fetch API not available. Please run with Node.js v18 or newer.');
}

const METRICS = [
  {
    key: 'CO2',
    label: 'CO\u2082',
    unit: 'ppm',
    decimals: 0,
    promNames: ['co2_ppm', 'CO2', 'co2'],
    queryNames: ['CO\u2082', 'CO2', 'co2', 'co2_ppm'],
    slug: 'co2'
  },
  {
    key: 'PM1.0',
    label: 'PM1',
    unit: '\u00b5g/m\u00b3',
    decimals: 1,
    promNames: ['pm1', 'PM1.0', 'pm1.0'],
    queryNames: ['PM1', 'PM1.0', 'pm1'],
    slug: 'pm1'
  },
  {
    key: 'PM2.5',
    label: 'PM2.5',
    unit: '\u00b5g/m\u00b3',
    decimals: 1,
    promNames: ['pm25', 'PM2.5', 'pm2_5', 'pm2.5'],
    queryNames: ['PM2.5', 'pm2.5', 'pm25'],
    slug: 'pm25'
  },
  {
    key: 'PM10',
    label: 'PM10',
    unit: '\u00b5g/m\u00b3',
    decimals: 1,
    promNames: ['pm10', 'PM10'],
    queryNames: ['PM10', 'pm10'],
    slug: 'pm10'
  },
  {
    key: 'Temperatur',
    label: 'Temperatur',
    unit: '\u00b0C',
    decimals: 1,
    promNames: [
      'temp_final',
      'temperatur',
      'temperatur_kalibriert',
      'temperatur__bme_kalibriert_',
      'temperature',
      'temp'
    ],
    queryNames: ['Temperatur', 'temperatur', 'temperature', 'temp', 'temp_final', 'temperature_final'],
    slug: 'temp_final'
  },
  {
    key: 'rel. Feuchte',
    label: 'rel. Feuchte',
    unit: '%',
    decimals: 1,
    promNames: ['humidity', 'rel. Feuchte', 'rel_feuchte'],
    queryNames: ['rel. Feuchte', 'relfeuchte', 'luftfeuchte', 'humidity'],
    slug: 'humidity'
  },
  {
    key: 'Lux',
    label: 'Lux',
    unit: 'lx',
    decimals: 0,
    promNames: ['lux', 'Lux', 'beleuchtungsstaerke'],
    queryNames: ['Lux', 'lux'],
    slug: 'lux'
  },
  {
    key: 'Farbtemperatur',
    label: 'CCT',
    unit: 'K',
    decimals: 0,
    promNames: ['cct_k', 'Farbtemperatur', 'cct', 'farbtemperatur'],
    queryNames: ['CCT', 'Farbtemperatur', 'cct', 'cct_k'],
    slug: 'cct_k'
  },
  {
    key: 'Luftdruck',
    label: 'Luftdruck',
    unit: 'hPa',
    decimals: 1,
    promNames: ['pressure_hpa', 'Luftdruck', 'pressure', 'luftdruck'],
    queryNames: ['Luftdruck', 'druck', 'pressure_hpa'],
    slug: 'pressure_hpa'
  },
  {
    key: 'TVOC',
    label: 'TVOC',
    unit: 'ppb',
    decimals: 0,
    promNames: ['tvoc', 'TVOC'],
    queryNames: ['TVOC', 'voc', 'tvoc'],
    slug: 'tvoc'
  }
];

const QUERY_LOOKUP = new Map();
const KNOWN_QUERY_KEYS = new Set();

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
    const nameLiteral = String(req.query.name || '');
    const metric = QUERY_LOOKUP.get(normalizeQueryName(nameLiteral));

    if (!metric) {
      return sendJSON(
        res,
        { ok: false, error: 'unknown_metric', known: Array.from(KNOWN_QUERY_KEYS).sort() },
        400
      );
    }

    const rangeLiteral = req.query.range ? String(req.query.range) : '24h';
    const stepLiteral = req.query.step ? String(req.query.step) : '120s';
    const windowLiteral = req.query.win ? String(req.query.win) : '10m';

    const rangeSeconds = parseDuration(rangeLiteral);
    const stepSeconds = parseDuration(stepLiteral);
    const windowSeconds = parseDuration(windowLiteral);

    if (!Number.isFinite(rangeSeconds) || rangeSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'Ung\u00fcltiger range Parameter' }, 400);
    }
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'Ung\u00fcltiger step Parameter' }, 400);
    }
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      return sendJSON(res, { ok: false, error: 'Ung\u00fcltiger win Parameter' }, 400);
    }
    if (windowSeconds > rangeSeconds) {
      return sendJSON(
        res,
        { ok: false, error: 'win darf nicht gr\u00f6\u00dfer als range sein' },
        400
      );
    }
    if (rangeSeconds > MAX_RANGE_SECONDS) {
      return sendJSON(
        res,
        {
          ok: false,
          error: `range ist zu gro\u00df (max. ${Math.floor(MAX_RANGE_SECONDS / 86400)} Tage)`
        },
        400
      );
    }

    const endSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = Math.max(0, endSeconds - rangeSeconds);
    const promNameEscaped = escapePromString(metric.promQueryName || metric.key);
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
      .map((entry) => {
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

app.use('/api', (req, res) => {
  sendJSON(res, { ok: false, error: 'Nicht gefunden' }, 404);
});

app.use((err, req, res, next) => {
  const status = Number.isInteger(err?.status) ? err.status : 502;
  const message =
    err?.message ||
    'Unerwarteter Fehler beim Zugriff auf Prometheus. Bitte Backend-Logs pr\u00fcfen.';
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

function gracefulShutdown(signal) {
  console.log(`[airguard-web] Received ${signal}, shutting down...`);
  server.close(() => {
    console.log('[airguard-web] Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
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
      const details = body?.error || response.statusText;
      const error = new Error(`Prometheus-Antwort ${response.status}: ${details}`);
      error.status = response.status;
      throw error;
    }

    const body = await response.json();
    if (body?.status !== 'success') {
      const error = new Error(body?.error || 'Prometheus lieferte keinen Erfolg-Status');
      error.status = 502;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(
        `Prometheus Anfrage dauerte l\u00e4nger als ${PROM_TIMEOUT_MS} ms`
      );
      timeoutError.status = 504;
      throw timeoutError;
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