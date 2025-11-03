import { Chart, registerables } from '/lib/chart.esm.js';
import '/lib/chartjs-adapter-date-fns.js';

Chart.register(...registerables);

const METRICS = [
  { key: 'CO2', label: 'CO\u2082', unit: 'ppm', decimals: 0, color: '#d3524d' },
  { key: 'PM1.0', label: 'PM1.0', unit: '\u00b5g/m\u00b3', decimals: 1, color: '#008f8c' },
  { key: 'PM2.5', label: 'PM2.5', unit: '\u00b5g/m\u00b3', decimals: 1, color: '#0077b6' },
  { key: 'PM10', label: 'PM10', unit: '\u00b5g/m\u00b3', decimals: 1, color: '#f8961e' },
  { key: 'Temperatur', label: 'Temperatur', unit: '\u00b0C', decimals: 1, color: '#f25f5c' },
  { key: 'rel. Feuchte', label: 'rel. Feuchte', unit: '%', decimals: 1, color: '#43aa8b' },
  { key: 'Luftdruck', label: 'Luftdruck', unit: 'hPa', decimals: 1, color: '#577590' },
  { key: 'TVOC', label: 'TVOC', unit: 'ppb', decimals: 0, color: '#b56576' },
  { key: 'Lux', label: 'Lux', unit: 'lx', decimals: 0, color: '#ffd166' },
  { key: 'Farbtemperatur', label: 'Farbtemperatur', unit: 'K', decimals: 0, color: '#9c89b8' }
];

const TIME_RANGES = [
  { id: '4h', label: '4 Std', range: '4h', step: '60s', win: '5m' },
  { id: '24h', label: '24 Std', range: '24h', step: '120s', win: '10m' },
  { id: '7d', label: '7 Tage', range: '7d', step: '15m', win: '30m' }
];

const NOW_REFRESH_MS = 15000;
const SERIES_REFRESH_MS = 90000;

const state = {
  currentRange: TIME_RANGES[1],
  charts: new Map(),
  summary: new Map(),
  timers: []
};

const ui = {
  status: null,
  updated: null,
  summaryGrid: null,
  chartGrid: null,
  rangeButtons: null
};

document.addEventListener('DOMContentLoaded', () => {
  ui.status = document.getElementById('status-text');
  ui.updated = document.getElementById('last-updated');
  ui.summaryGrid = document.getElementById('summary-grid');
  ui.chartGrid = document.getElementById('chart-grid');
  ui.rangeButtons = document.getElementById('range-buttons');

  setStatus('Lade Daten...', false);
  buildRangeButtons();
  buildSummaryGrid();
  buildChartGrid();

  refreshAll(true).catch(reportError);
  scheduleUpdates();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshAll(false).catch(reportError);
    }
  });
});

function scheduleUpdates() {
  state.timers.push(
    setInterval(() => {
      refreshNow().catch(reportError);
    }, NOW_REFRESH_MS)
  );
  state.timers.push(
    setInterval(() => {
      refreshSeries(false).catch(reportError);
    }, SERIES_REFRESH_MS)
  );

  window.addEventListener('beforeunload', () => {
    state.timers.forEach((timer) => clearInterval(timer));
  });
}

async function refreshAll(initial) {
  const tasks = await Promise.allSettled([refreshNow(), refreshSeries(initial)]);
  const failure = tasks.find((task) => task.status === 'rejected');
  if (!failure) {
    setStatus(`Zuletzt aktualisiert ${formatTimestamp(Date.now())}`, false);
  } else {
    reportError(failure.reason);
  }
}

async function refreshNow() {
  const response = await fetchJson('/api/now');
  if (!response.ok) {
    throw new Error(response.error || 'API /api/now lieferte einen Fehler');
  }

  if (typeof response.ts === 'number') {
    setLastUpdated(response.ts);
  }

  METRICS.forEach((metric) => {
    const entry = response.data?.[metric.key] || null;
    updateSummaryCard(metric, entry);
  });

  return true;
}

async function refreshSeries(initial) {
  const params = new URLSearchParams({
    range: state.currentRange.range,
    step: state.currentRange.step,
    win: state.currentRange.win
  });

  const requests = METRICS.map(async (metric) => {
    const url = `/api/series?name=${encodeURIComponent(metric.key)}&${params.toString()}`;
    const response = await fetchJson(url);
    if (!response.ok) {
      throw new Error(response.error || `API /api/series fehlgeschlagen f\u00fcr ${metric.label}`);
    }
    const dataset = Array.isArray(response.data) ? response.data : [];
    applySeries(metric, dataset, initial);
    return true;
  });

  const outcomes = await Promise.allSettled(requests);
  const failure = outcomes.find((item) => item.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
  return true;
}

function buildRangeButtons() {
  ui.rangeButtons.innerHTML = '';
  TIME_RANGES.forEach((range) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'range-button';
    button.textContent = range.label;
    button.classList.toggle('is-active', range.id === state.currentRange.id);
    button.addEventListener('click', () => {
      if (state.currentRange.id === range.id) {
        return;
      }
      state.currentRange = range;
      updateRangeButtonState();
      refreshSeries(true).catch(reportError);
    });
    ui.rangeButtons.append(button);
  });
}

function updateRangeButtonState() {
  const buttons = ui.rangeButtons.querySelectorAll('button');
  buttons.forEach((button, index) => {
    const range = TIME_RANGES[index];
    button.classList.toggle('is-active', range && range.id === state.currentRange.id);
  });
}

function buildSummaryGrid() {
  ui.summaryGrid.innerHTML = '';
  METRICS.forEach((metric) => {
    const card = document.createElement('article');
    card.className = 'metric-card';
    card.dataset.metric = metric.key;

    const header = document.createElement('header');
    header.className = 'metric-header';
    header.textContent = metric.label;

    const reading = document.createElement('p');
    reading.className = 'metric-reading';

    const valueEl = document.createElement('span');
    valueEl.className = 'metric-value';
    valueEl.textContent = '--';

    const unitEl = document.createElement('span');
    unitEl.className = 'metric-unit';
    unitEl.textContent = metric.unit;

    reading.append(valueEl, unitEl);

    const meta = document.createElement('p');
    meta.className = 'metric-meta';
    const label = document.createElement('span');
    label.textContent = 'Aktualisiert: ';
    const timeEl = document.createElement('time');
    timeEl.textContent = '—';
    meta.append(label, timeEl);

    card.append(header, reading, meta);
    ui.summaryGrid.append(card);

    state.summary.set(metric.key, {
      card,
      valueEl,
      timeEl
    });
  });
}

function buildChartGrid() {
  ui.chartGrid.innerHTML = '';
  METRICS.forEach((metric) => {
    const card = document.createElement('article');
    card.className = 'chart-card';
    card.dataset.metric = metric.key;

    const header = document.createElement('header');
    header.className = 'chart-header';

    const title = document.createElement('h3');
    title.textContent = metric.label;

    const unit = document.createElement('span');
    unit.className = 'chart-unit';
    unit.textContent = metric.unit;

    header.append(title, unit);

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 240;

    card.append(header, canvas);
    ui.chartGrid.append(card);

    const context = canvas.getContext('2d');
    const chart = new Chart(context, {
      type: 'line',
      data: {
        datasets: [
          {
            label: `${metric.label} (${metric.unit})`,
            data: [],
            borderColor: metric.color,
            backgroundColor: hexWithAlpha(metric.color, 0.16),
            pointRadius: 0,
            pointHitRadius: 6,
            tension: 0.25,
            fill: true,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        normalized: true,
        animation: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label(context) {
                const value = context.parsed.y;
                return `${formatNumber(metric, value)} ${metric.unit}`;
              }
            }
          },
          decimation: {
            enabled: true,
            algorithm: 'lttb',
            samples: 250
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              tooltipFormat: "dd.MM.yyyy HH:mm",
              displayFormats: {
                minute: "HH:mm",
                hour: "HH:mm",
                day: "dd.MM."
              }
            },
            ticks: {
              maxRotation: 0,
              color: '#51606b'
            },
            grid: {
              color: 'rgba(15,23,42,0.06)'
            }
          },
          y: {
            title: {
              display: true,
              text: metric.unit
            },
            ticks: {
              color: '#51606b',
              callback(value) {
                return formatNumber(metric, value);
              }
            },
            grid: {
              color: 'rgba(15,23,42,0.08)'
            }
          }
        }
      }
    });

    state.charts.set(metric.key, chart);
  });
}

function updateSummaryCard(metric, entry) {
  const record = state.summary.get(metric.key);
  if (!record) {
    return;
  }
  if (!entry || !Number.isFinite(entry.value) || !Number.isFinite(entry.ts)) {
    record.valueEl.textContent = '--';
    record.timeEl.textContent = '—';
    record.card.dataset.state = 'missing';
    return;
  }

  record.valueEl.textContent = formatNumber(metric, entry.value);
  record.timeEl.textContent = formatTimestamp(entry.ts);
  record.card.dataset.state = 'ok';

  if (entry.labels) {
    record.card.dataset.labels = JSON.stringify(entry.labels);
  }
}

function applySeries(metric, points, initial) {
  const chart = state.charts.get(metric.key);
  if (!chart) {
    return;
  }
  const cleaned = points
    .map((point) => ({
      x: point.x,
      y: point.y
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  chart.data.datasets[0].data = cleaned;
  chart.options.animation = initial ? false : { duration: 220 };
  chart.update('none');
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function formatNumber(metric, value) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  const cacheKey = `${metric.key}:${metric.decimals}`;
  if (!formatNumber.cache.has(cacheKey)) {
    formatNumber.cache.set(
      cacheKey,
      new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: metric.decimals,
        maximumFractionDigits: metric.decimals
      })
    );
  }
  return formatNumber.cache.get(cacheKey).format(value);
}
formatNumber.cache = new Map();

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return '—';
  }
  if (!formatTimestamp.formatter) {
    formatTimestamp.formatter = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  return formatTimestamp.formatter.format(new Date(timestamp));
}

function setLastUpdated(timestamp) {
  if (ui.updated) {
    ui.updated.textContent = formatTimestamp(timestamp);
  }
}

function setStatus(message, isError) {
  if (!ui.status) {
    return;
  }
  ui.status.textContent = message || '';
  ui.status.dataset.state = isError ? 'error' : 'ok';
}

function reportError(error) {
  console.error(error);
  setStatus(error?.message || 'Unbekannter Fehler', true);
}

function hexWithAlpha(hex, alpha) {
  const clean = hex.replace('#', '').trim();
  const bigint = Number.parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}