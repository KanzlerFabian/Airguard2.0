'use strict';

const chartExport = window.Chart;
const ChartJS = chartExport && chartExport.Chart ? chartExport.Chart : chartExport;

if (!ChartJS || typeof ChartJS.register !== 'function') {
  throw new Error('Chart.js konnte nicht geladen werden.');
}

if (Array.isArray(ChartJS.registerables) && ChartJS.registerables.length > 0) {
  ChartJS.register(...ChartJS.registerables);
}

const requestIdle = window.requestIdleCallback || function (cb) {
  return window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1);
};

const TIME_RANGES = [
  { id: '24h', label: '24 h', range: '24h', step: '10m', win: '15m' },
  { id: 'week', label: 'Woche', range: '7d', step: '30m', win: '1h' },
  { id: 'month', label: 'Monat', range: '30d', step: '2h', win: '3h' }
];

const METRICS = [
  {
    key: 'CO2',
    label: 'CO₂',
    unit: 'ppm',
    decimals: 0,
    summary: true,
    chart: true,
    chartGroup: 'main',
    color: '#ef4444',
    hint: 'Kohlendioxid-Konzentration (ppm)'
  },
  {
    key: 'PM2.5',
    label: 'PM2.5',
    unit: '\u00b5g/m\u00b3',
    decimals: 0,
    summary: true,
    chart: true,
    chartGroup: 'main',
    color: '#2563eb',
    hint: 'Feinstaub (2.5\u00b5m) in der Luft'
  },
  {
    key: 'TVOC',
    label: 'TVOC',
    unit: 'ppb',
    decimals: 0,
    summary: true,
    chart: true,
    chartGroup: 'more',
    color: '#8b5cf6',
    hint: 'Fl\u00fcchtige organische Verbindungen'
  },
  {
    key: 'Temperatur',
    label: 'room_temp',
    unit: '\u00b0C',
    decimals: 1,
    summary: true,
    chart: true,
    chartGroup: 'main',
    color: '#f97316',
    hint: 'Raumtemperatur'
  },
  {
    key: 'rel. Feuchte',
    label: 'rF',
    unit: '%',
    decimals: 0,
    summary: true,
    chart: true,
    chartGroup: 'main',
    color: '#0ea5e9',
    hint: 'Relative Luftfeuchtigkeit'
  },
  {
    key: 'Lux',
    label: 'Lux',
    unit: 'lx',
    decimals: 0,
    summary: true,
    chart: false,
    chartGroup: 'none',
    color: '#facc15',
    hint: 'Beleuchtungsst\u00e4rke'
  },
  {
    key: 'PM10',
    label: 'PM10',
    unit: '\u00b5g/m\u00b3',
    decimals: 0,
    summary: false,
    chart: true,
    chartGroup: 'more',
    color: '#22c55e',
    hint: 'Feinstaub (10\u00b5m)'
  }
];

const SUMMARY_METRICS = METRICS.filter((metric) => metric.summary);
const MAIN_CHART_METRICS = METRICS.filter((metric) => metric.chart && metric.chartGroup === 'main');
const MORE_CHART_METRICS = METRICS.filter((metric) => metric.chart && metric.chartGroup === 'more');
const SERIES_METRICS = METRICS.filter((metric) => metric.chart || metric.summary);

const NOW_REFRESH_MS = 30000;
const HEALTH_REFRESH_MS = 30000;
const SERIES_REFRESH_MS = 180000;
const AQI_TREND_REFRESH_MS = 300000;

const state = {
  currentRange: TIME_RANGES[0],
  summary: new Map(),
  charts: new Map(),
  sparklines: new Map(),
  timers: [],
  aqi: {
    badge: null,
    scoreEl: null,
    textEl: null,
    chart: null
  }
};

const ui = {
  status: null,
  updated: null,
  rangeTabs: null,
  metricGrid: null,
  chartGrid: null,
  moreChartGrid: null
};

document.addEventListener('DOMContentLoaded', () => {
  ui.status = document.getElementById('status-text');
  ui.updated = document.getElementById('last-updated');
  ui.rangeTabs = document.getElementById('range-tabs');
  ui.metricGrid = document.getElementById('metric-grid');
  ui.chartGrid = document.getElementById('chart-grid');
  ui.moreChartGrid = document.getElementById('more-chart-grid');

  const badge = document.getElementById('aqi-badge');
  state.aqi.badge = badge;
  state.aqi.scoreEl = document.getElementById('aqi-score');
  state.aqi.textEl = document.getElementById('aqi-text');
  const aqiCanvas = document.getElementById('aqi-sparkline');
  if (aqiCanvas) {
    state.aqi.chart = new ChartJS(aqiCanvas.getContext('2d'), buildSparklineConfig('#2563eb'));
  }

  setStatus('Lade Daten...', false);
  buildRangeTabs();
  buildMetricCards();
  buildCharts();

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
      refreshHealth().catch(reportError);
    }, HEALTH_REFRESH_MS)
  );
  state.timers.push(
    setInterval(() => {
      refreshSeries(false).catch(reportError);
    }, SERIES_REFRESH_MS)
  );
  state.timers.push(
    setInterval(() => {
      refreshAqiTrend().catch(reportError);
    }, AQI_TREND_REFRESH_MS)
  );

  window.addEventListener('beforeunload', () => {
    state.timers.forEach((timer) => clearInterval(timer));
  });
}

async function refreshAll(initial) {
  const tasks = await Promise.allSettled([
    refreshNow(),
    refreshHealth(),
    refreshSeries(initial),
    refreshAqiTrend()
  ]);

  const failure = tasks.find((task) => task.status === 'rejected');
  if (failure) {
    reportError(failure.reason);
  } else {
    setStatus(`Zuletzt aktualisiert ${formatTimestamp(Date.now())}`, false);
  }
}

async function refreshNow() {
  const response = await fetchJson('/api/now');
  if (!response.ok) {
    handleMissingNow(response.error);
    return;
  }

  if (typeof response.ts === 'number') {
    setLastUpdated(response.ts);
  }

  SUMMARY_METRICS.forEach((metric) => {
    const entry = response.data?.[metric.key] || null;
    updateSummaryCard(metric, entry, response.ts);
  });
}

async function refreshHealth() {
  const response = await fetchJson('/api/health');
  if (!response.ok) {
    updateAqiBadge(null, response.error);
    return;
  }
  updateAqiBadge(response.data || null);
}

async function refreshAqiTrend() {
  const params = new URLSearchParams({
    name: 'PM2.5',
    range: '12h',
    step: '10m'
  });
  const response = await fetchJson(`/api/series?${params.toString()}`);
  if (!response.ok) {
    updateAqiSparkline([]);
    return;
  }
  const dataset = Array.isArray(response.data) ? response.data : [];
  updateAqiSparkline(dataset);
}

async function refreshSeries(initial) {
  const params = new URLSearchParams({
    range: state.currentRange.range,
    step: state.currentRange.step,
    win: state.currentRange.win
  });

  const requests = SERIES_METRICS.map(async (metric) => {
    const url = `/api/series?name=${encodeURIComponent(metric.key)}&${params.toString()}`;
    const response = await fetchJson(url);
    if (!response.ok) {
      applySeries(metric, [], initial);
      return;
    }
    const dataset = Array.isArray(response.data) ? response.data : [];
    applySeries(metric, dataset, initial);
  });

  await Promise.all(requests);
}

function buildRangeTabs() {
  ui.rangeTabs.innerHTML = '';
  TIME_RANGES.forEach((range, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'range-tab';
    button.textContent = range.label;
    button.dataset.rangeId = range.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', range.id === state.currentRange.id ? 'true' : 'false');
    button.id = `range-${range.id}`;
    button.tabIndex = range.id === state.currentRange.id ? 0 : -1;
    button.classList.toggle('is-active', range.id === state.currentRange.id);
    button.addEventListener('click', () => {
      if (state.currentRange.id === range.id) {
        return;
      }
      state.currentRange = range;
      updateRangeTabs(range.id);
      refreshSeries(true).catch(reportError);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (index + direction + TIME_RANGES.length) % TIME_RANGES.length;
        ui.rangeTabs.children[nextIndex].focus();
        ui.rangeTabs.children[nextIndex].click();
      }
    });
    ui.rangeTabs.append(button);
  });
}

function updateRangeTabs(activeId) {
  const buttons = ui.rangeTabs.querySelectorAll('.range-tab');
  buttons.forEach((button) => {
    const isActive = button.dataset.rangeId === activeId;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });
}

function buildMetricCards() {
  ui.metricGrid.innerHTML = '';
  SUMMARY_METRICS.forEach((metric) => {
    const card = document.createElement('article');
    card.className = 'metric-card';
    card.dataset.metric = metric.key;
    card.setAttribute('role', 'listitem');

    const title = document.createElement('header');
    title.className = 'metric-title';
    title.textContent = metric.label;

    const valueWrap = document.createElement('div');
    valueWrap.className = 'metric-reading';

    const valueEl = document.createElement('span');
    valueEl.className = 'metric-value';
    valueEl.textContent = '—';

    const unitEl = document.createElement('span');
    unitEl.className = 'metric-unit';
    unitEl.textContent = metric.unit;

    valueWrap.append(valueEl, unitEl);

    const meta = document.createElement('p');
    meta.className = 'metric-meta';
    meta.innerHTML = 'Aktualisiert <time>—</time>';
    const timeEl = meta.querySelector('time');

    const sparklineWrap = document.createElement('div');
    sparklineWrap.className = 'metric-sparkline';
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 48;
    sparklineWrap.append(canvas);

    const note = document.createElement('p');
    note.className = 'metric-note';
    note.textContent = 'Keine Daten verfügbar';
    note.hidden = true;

    card.append(title, valueWrap, sparklineWrap, meta, note);
    card.title = `${metric.hint}`;

    ui.metricGrid.append(card);

    const sparkRecord = { chart: null, note, pendingData: [] };
    state.sparklines.set(metric.key, sparkRecord);

    requestIdle(() => {
      const sparkChart = new ChartJS(canvas.getContext('2d'), buildSparklineConfig(metric.color));
      sparkRecord.chart = sparkChart;
      if (sparkRecord.pendingData.length > 0) {
        sparkChart.data.datasets[0].data = sparkRecord.pendingData;
        sparkChart.update('none');
      }
    });

    state.summary.set(metric.key, {
      card,
      valueEl,
      timeEl,
      note,
      canvas
    });
  });
}

function buildCharts() {
  ui.chartGrid.innerHTML = '';
  ui.moreChartGrid.innerHTML = '';

  const build = (metric, target) => {
    const card = document.createElement('article');
    card.className = 'chart-card';
    card.dataset.metric = metric.key;
    card.setAttribute('role', 'listitem');

    const header = document.createElement('header');
    header.className = 'chart-header';

    const title = document.createElement('h3');
    title.textContent = metric.label;

    const unit = document.createElement('span');
    unit.className = 'chart-unit';
    unit.textContent = metric.unit;

    header.append(title, unit);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'chart-canvas';
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    canvasWrap.append(canvas);

    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Keine Daten verfügbar';
    empty.hidden = true;

    card.append(header, canvasWrap, empty);
    target.append(card);

    const chart = new ChartJS(canvas.getContext('2d'), buildLineChartConfig(metric));
    state.charts.set(metric.key, { chart, emptyEl: empty });
  };

  MAIN_CHART_METRICS.forEach((metric) => build(metric, ui.chartGrid));
  MORE_CHART_METRICS.forEach((metric) => build(metric, ui.moreChartGrid));
}

function updateSummaryCard(metric, entry, fallbackTs) {
  const record = state.summary.get(metric.key);
  if (!record) {
    return;
  }

  if (!entry || !Number.isFinite(entry.value)) {
    record.valueEl.textContent = '—';
    record.timeEl.textContent = '—';
    record.card.dataset.state = 'missing';
    record.card.setAttribute('aria-busy', 'false');
    record.note.hidden = false;
    record.card.title = `${metric.hint}\nKeine aktuellen Daten verfügbar`;
    return;
  }

  record.valueEl.textContent = formatValue(metric.key, entry.value);
  record.timeEl.textContent = formatTimestamp(entry.ts || fallbackTs);
  record.card.dataset.state = 'ok';
  record.card.setAttribute('aria-busy', 'false');
  record.note.hidden = true;
  record.card.title = `${metric.hint}\nAktualisiert: ${formatTimestamp(entry.ts || fallbackTs)}`;
}

function applySeries(metric, points, initial) {
  const chartRecord = state.charts.get(metric.key);
  if (chartRecord) {
    const cleaned = sanitizePoints(points);
    chartRecord.chart.data.datasets[0].data = cleaned;
    if (cleaned.length > 0) {
      const values = cleaned.map((point) => point.y);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const padding = (max - min) * 0.1 || 1;
      chartRecord.chart.options.scales.y.suggestedMin = min - padding;
      chartRecord.chart.options.scales.y.suggestedMax = max + padding;
      chartRecord.emptyEl.hidden = true;
    } else {
      chartRecord.chart.options.scales.y.suggestedMin = undefined;
      chartRecord.chart.options.scales.y.suggestedMax = undefined;
      chartRecord.emptyEl.hidden = false;
    }
    chartRecord.chart.update(initial ? 'none' : 'default');
  }

  const sparkline = state.sparklines.get(metric.key);
  if (sparkline) {
    const cleaned = sanitizePoints(points);
    sparkline.pendingData = cleaned;
    if (sparkline.chart) {
      sparkline.chart.data.datasets[0].data = cleaned;
      sparkline.chart.update('none');
    }
    sparkline.note.hidden = cleaned.length > 0;
  }
}

function updateAqiBadge(data, error) {
  if (!state.aqi.badge) {
    return;
  }

  const badge = state.aqi.badge;
  const scoreEl = state.aqi.scoreEl;
  const textEl = state.aqi.textEl;

  badge.classList.remove('badge--good', 'badge--ok', 'badge--bad', 'badge--neutral');

  if (!data || !Number.isFinite(data.score)) {
    scoreEl.textContent = '—';
    textEl.textContent = error ? 'Fehler' : 'n/v';
    badge.classList.add('badge--neutral');
    badge.setAttribute('aria-label', 'Air Quality Index: nicht verfügbar');
    return;
  }

  const score = Math.round(data.score);
  scoreEl.textContent = `${score}`;
  textEl.textContent = data.label || '';

  if (score >= 70) {
    badge.classList.add('badge--good');
    badge.setAttribute('aria-label', `Air Quality Index ${score}: ${data.label || 'gut'}`);
  } else if (score >= 40) {
    badge.classList.add('badge--ok');
    badge.setAttribute('aria-label', `Air Quality Index ${score}: ${data.label || 'mäßig'}`);
  } else {
    badge.classList.add('badge--bad');
    badge.setAttribute('aria-label', `Air Quality Index ${score}: ${data.label || 'schlecht'}`);
  }
}

function updateAqiSparkline(points) {
  if (!state.aqi.chart) {
    return;
  }
  const cleaned = sanitizePoints(points);
  state.aqi.chart.data.datasets[0].data = cleaned;
  state.aqi.chart.update('none');
}

function sanitizePoints(points) {
  return points
    .map((point) => ({ x: point.x, y: point.y }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function handleMissingNow(errorMessage) {
  SUMMARY_METRICS.forEach((metric) => {
    const record = state.summary.get(metric.key);
    if (record) {
      record.valueEl.textContent = '—';
      record.timeEl.textContent = '—';
      record.card.dataset.state = 'missing';
      record.note.hidden = false;
      record.card.title = `${metric.hint}\nKeine aktuellen Daten verfügbar`;
    }
  });
  setStatus(errorMessage || 'Keine Live-Daten verfügbar', true);
}

function formatValue(metricKey, value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const metric = METRICS.find((item) => item.key === metricKey);
  if (!metric) {
    return value.toString();
  }

  const options = {
    minimumFractionDigits: metric.decimals,
    maximumFractionDigits: metric.decimals
  };

  if (metric.key === 'CO2') {
    options.useGrouping = true;
  }

  if (metric.key === 'Temperatur' && metric.decimals === 1) {
    options.minimumFractionDigits = 1;
    options.maximumFractionDigits = 1;
  }

  const formatterKey = `${metric.key}:${metric.decimals}`;
  if (!formatValue.cache.has(formatterKey)) {
    formatValue.cache.set(formatterKey, new Intl.NumberFormat('de-DE', options));
  }
  return formatValue.cache.get(formatterKey).format(value);
}
formatValue.cache = new Map();

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

function buildSparklineConfig(color) {
  return {
    type: 'line',
    data: {
      datasets: [
        {
          data: [],
          borderColor: color,
          borderWidth: 2,
          backgroundColor: hexWithAlpha(color, 0.2),
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        decimation: { enabled: true, algorithm: 'lttb', samples: 60 }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour' },
          display: false
        },
        y: {
          display: false
        }
      }
    }
  };
}

function buildLineChartConfig(metric) {
  return {
    type: 'line',
    data: {
      datasets: [
        {
          data: [],
          label: `${metric.label} (${metric.unit})`,
          borderColor: metric.color,
          backgroundColor: hexWithAlpha(metric.color, 0.18),
          tension: 0.3,
          fill: true,
          pointRadius: 0,
          pointHitRadius: 8,
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
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed.y;
              return `${formatValue(metric.key, value)} ${metric.unit}`;
            }
          }
        },
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: 400
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: "dd.MM.yyyy HH:mm",
            displayFormats: {
              minute: 'HH:mm',
              hour: 'HH:mm',
              day: 'dd.MM.',
              week: 'dd.MM.'
            }
          },
          grid: { color: 'rgba(100, 116, 139, 0.12)' },
          ticks: { maxRotation: 0 }
        },
        y: {
          ticks: {
            callback(value) {
              return formatValue(metric.key, value);
            }
          },
          grid: { color: 'rgba(100, 116, 139, 0.12)' }
        }
      }
    }
  };
}

function hexWithAlpha(hex, alpha) {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) {
    return hex;
  }
  const bigint = Number.parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
