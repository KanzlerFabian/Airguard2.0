'use strict';

(function () {
  const supportsNotification = typeof Notification !== 'undefined';
  const { Chart } = window;
  if (!Chart) {
    console.error('Chart.js wurde nicht geladen.');
    return;
  }

  if (Array.isArray(Chart.registerables)) {
    Chart.register(...Chart.registerables);
  }
  Chart.defaults.font.family = "'Inter','Segoe UI',system-ui,sans-serif";
  Chart.defaults.color = '#6b7280';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.position = 'bottom';
  Chart.defaults.plugins.tooltip.mode = 'index';
  Chart.defaults.plugins.tooltip.intersect = false;

  const CIRCUMFERENCE = 339.292;
  const NOW_REFRESH_MS = 60_000;
  const CHART_REFRESH_MS = 300_000;
  const PRESSURE_REFRESH_MS = 600_000;

  const TIME_RANGES = {
    '24h': { label: '24 h', range: '24h', step: '120s', win: '5m', samples: 28 },
    '7d': { label: '7 Tage', range: '7d', step: '45m', win: '2h', samples: 40 },
    '30d': { label: '30 Tage', range: '30d', step: '3h', win: '6h', samples: 45 }
  };

  const METRIC_CONFIG = {
    CO2: { unit: 'ppm', decimals: 0, label: 'CO₂' },
    'PM2.5': { unit: 'µg/m³', decimals: 1, label: 'PM2.5' },
    TVOC: { unit: 'ppb', decimals: 0, label: 'TVOC' },
    Temperatur: { unit: '°C', decimals: 1, label: 'Temperatur' },
    'rel. Feuchte': { unit: '%', decimals: 0, label: 'rel. Feuchte' },
    Lux: { unit: 'lx', decimals: 0, label: 'Lux' },
    Luftdruck: { unit: 'hPa', decimals: 1, label: 'Luftdruck' },
    'PM1.0': { unit: 'µg/m³', decimals: 1, label: 'PM1.0' },
    PM10: { unit: 'µg/m³', decimals: 1, label: 'PM10' }
  };

  const CHART_DEFINITIONS = [
    {
      key: 'CO2',
      metrics: ['CO2'],
      colors: ['#ef4444'],
      yTitle: 'ppm',
      yBounds: { min: 0, max: 2500 }
    },
    {
      key: 'PM',
      metrics: ['PM1.0', 'PM2.5', 'PM10'],
      colors: ['#22d3ee', '#2563eb', '#0f766e'],
      yTitle: 'µg/m³',
      yBounds: { min: 0, max: 100 }
    },
    {
      key: 'Temperatur',
      metrics: ['Temperatur'],
      colors: ['#fb923c'],
      yTitle: '°C',
      yBounds: { min: -10, max: 40 }
    },
    {
      key: 'rel. Feuchte',
      metrics: ['rel. Feuchte'],
      colors: ['#0ea5e9'],
      yTitle: '%',
      yBounds: { min: 0, max: 100 }
    },
    {
      key: 'TVOC',
      metrics: ['TVOC'],
      colors: ['#8b5cf6'],
      yTitle: 'ppb',
      yBounds: { min: 0, max: 1000 }
    },
    {
      key: 'Luftdruck',
      metrics: ['Luftdruck'],
      colors: ['#a855f7'],
      yTitle: 'hPa',
      yBounds: { min: 950, max: 1050 },
      optional: true
    }
  ];

  const state = {
    range: TIME_RANGES['24h'],
    charts: new Map(),
    chartDataCache: new Map(),
    timers: [],
    now: null,
    lastPressureFetch: 0,
    pressureTrend: null,
    deferredPrompt: null,
    notifyReady: supportsNotification && Notification.permission !== 'granted',
    alertFired: false
  };

  const ui = {
    heroCards: new Map(),
    statusCards: new Map(),
    chartCards: new Map(),
    chartCanvases: new Map(),
    lastUpdated: null,
    healthScore: null,
    healthLabel: null,
    healthDetail: null,
    healthProgress: null,
    circadianCard: null,
    circadianPhase: null,
    circadianStatus: null,
    circadianTip: null,
    luxNow: null,
    luxTarget: null,
    luxEval: null,
    rangeTabs: [],
    installBtn: null,
    notifyBtn: null,
    toast: null,
    toastText: null,
    toastClose: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    registerServiceWorker();
    setupInstallPrompt();
    setupNotifications();
    buildChartShells();
    refreshAll(true).catch(handleError);
    setupTimers();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshAll(false).catch(handleError);
      }
    });
  });

  function cacheElements() {
    ui.lastUpdated = document.getElementById('last-updated');
    ui.healthScore = document.getElementById('health-score');
    ui.healthLabel = document.getElementById('health-label');
    ui.healthDetail = document.getElementById('health-detail');
    ui.healthProgress = document.querySelector('.health-progress');
    ui.circadianCard = document.querySelector('.circadian-card');
    ui.circadianPhase = document.querySelector('.circadian-phase');
    ui.circadianStatus = document.querySelector('.circadian-status');
    ui.circadianTip = document.querySelector('.circadian-tip');
    ui.luxNow = document.getElementById('lux-now');
    ui.luxTarget = document.getElementById('lux-target');
    ui.luxEval = document.getElementById('lux-eval');
    ui.installBtn = document.getElementById('install-btn');
    ui.notifyBtn = document.getElementById('notify-btn');
    ui.toast = document.querySelector('.toast');
    ui.toastText = ui.toast?.querySelector('.toast-text') || null;
    ui.toastClose = ui.toast?.querySelector('.toast-close') || null;

    const miniCards = document.querySelectorAll('.mini-card');
    miniCards.forEach((card) => {
      const metric = card.getAttribute('data-metric');
      ui.heroCards.set(metric, card);
    });

    const statusCards = document.querySelectorAll('.status-card');
    statusCards.forEach((card) => {
      const metric = card.getAttribute('data-metric');
      ui.statusCards.set(metric, card);
    });

    const chartCards = document.querySelectorAll('.chart-card');
    chartCards.forEach((card) => {
      const key = card.getAttribute('data-chart');
      ui.chartCards.set(key, card);
      ui.chartCanvases.set(key, card.querySelector('canvas'));
    });

    ui.rangeTabs = Array.from(document.querySelectorAll('.range-tabs .tab'));
    ui.rangeTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.getAttribute('aria-selected') === 'true') return;
        ui.rangeTabs.forEach((other) => other.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        const key = tab.getAttribute('data-range');
        state.range = TIME_RANGES[key] || TIME_RANGES['24h'];
        refreshCharts(true).catch(handleError);
      });
    });

    if (ui.toastClose) {
      ui.toastClose.addEventListener('click', hideToast);
    }
  }

  function ensureTextNode(container) {
    if (!container) return null;
    if (!container.firstChild || container.firstChild.nodeType !== Node.TEXT_NODE) {
      container.insertBefore(document.createTextNode(''), container.firstChild || null);
    }
    return container.firstChild;
  }

  function setupTimers() {
    state.timers.push(setInterval(() => refreshNow().catch(handleError), NOW_REFRESH_MS));
    state.timers.push(setInterval(() => refreshCharts(false).catch(handleError), CHART_REFRESH_MS));
    state.timers.push(setInterval(() => refreshPressureTrend().catch(handleError), PRESSURE_REFRESH_MS));
    window.addEventListener('beforeunload', () => {
      state.timers.forEach((timer) => clearInterval(timer));
    });
  }

  async function refreshAll(initial) {
    await Promise.all([refreshNow(), refreshCharts(initial), refreshPressureTrend()]);
  }

  async function refreshNow() {
    const response = await fetch('./api/now', { headers: { 'Accept': 'application/json' } });
    if (!response.ok) {
      throw new Error('Fehler beim Laden der Live-Daten');
    }
    const payload = await response.json();
    if (!payload || !payload.ok) {
      throw new Error(payload?.error || 'API Antwort fehlerhaft');
    }

    const data = normalizeNowData(payload.data || {});
    state.now = data;
    updateTimestamp(payload.ts || Date.now());
    updateHero(data);
    updateStatusCards(data);
    updateCircadian(data);
    checkAlerts(data);
    if (data['Luftdruck']) {
      refreshPressureTrend().catch((error) => console.warn('Drucktrend Fehler', error));
    }
  }

  function normalizeNowData(raw) {
    const mapped = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!value) continue;
      mapped[key] = value;
    }
    return mapped;
  }

  function updateTimestamp(ts) {
    if (!ui.lastUpdated) return;
    const date = new Date(ts);
    ui.lastUpdated.textContent = isNaN(date.getTime())
      ? '—'
      : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  function updateHero(data) {
    const metrics = ['CO2', 'PM2.5', 'TVOC', 'rel. Feuchte'];
    const statuses = {};
    metrics.forEach((metric) => {
      const card = ui.heroCards.get(metric);
      const sample = data[metric];
      const config = METRIC_CONFIG[metric];
      if (!card || !config) return;
      if (!sample || !isFinite(sample.value)) {
        card.querySelector('.mini-value').textContent = '—';
        card.querySelector('.mini-unit').textContent = config.unit;
        card.classList.add('ready');
        return;
      }
      card.querySelector('.mini-value').textContent = formatNumber(sample.value, config.decimals);
      card.querySelector('.mini-unit').textContent = config.unit;
      card.classList.add('ready');
      statuses[metric] = determineStatus(metric, sample.value);
    });

    updateHealthCard(statuses);
  }

  function determineStatus(metric, value) {
    if (!isFinite(value)) {
      return { tone: 'neutral', label: 'n/v', note: '' };
    }

    switch (metric) {
      case 'CO2':
        if (value <= 800) return { tone: 'good', label: 'Hervorragend', note: 'Luft sehr frisch.' };
        if (value <= 1000) return { tone: 'good', label: 'Gut', note: 'Alles im grünen Bereich.' };
        if (value <= 1500) return { tone: 'mid', label: 'Mittel', note: 'Lüften empfohlen.' };
        return { tone: 'bad', label: 'Schlecht', note: 'Bitte sofort lüften.' };
      case 'PM2.5':
        if (value <= 15) return { tone: 'good', label: 'Gut', note: 'Feinstaub unkritisch.' };
        if (value <= 35) return { tone: 'ok', label: 'Mittel', note: 'Leichte Belastung.' };
        if (value <= 55) return { tone: 'mid', label: 'Warnung', note: 'Belastung steigt.' };
        return { tone: 'bad', label: 'Schlecht', note: 'Hohe Feinstaubbelastung.' };
      case 'TVOC':
        if (value <= 150) return { tone: 'good', label: 'Hervorragend', note: 'Kaum VOC-Belastung.' };
        if (value <= 300) return { tone: 'good', label: 'Gut', note: 'Alles ok.' };
        if (value <= 1000) return { tone: 'mid', label: 'Mittel', note: 'Lüften sinnvoll.' };
        return { tone: 'bad', label: 'Schlecht', note: 'Starke VOC-Belastung.' };
      case 'Temperatur':
        if (value < 19) return { tone: 'mid', label: 'kühl', note: 'Etwas wärmer stellen.' };
        if (value <= 24) return { tone: 'good', label: 'ok', note: 'Komfortbereich.' };
        if (value <= 27) return { tone: 'ok', label: 'warm', note: 'Leicht erhöht.' };
        return { tone: 'bad', label: 'zu heiß', note: 'Abkühlen empfohlen.' };
      case 'rel. Feuchte':
        if (value < 30) return { tone: 'mid', label: 'trocken', note: 'Luft zu trocken.' };
        if (value <= 60) return { tone: 'good', label: 'ok', note: 'Optimale Luftfeuchte.' };
        return { tone: 'mid', label: 'feucht', note: 'Luftfeuchte senken.' };
      default:
        return { tone: 'neutral', label: '', note: '' };
    }
  }

  function updateHealthCard(statuses) {
    if (!ui.healthScore || !ui.healthLabel || !ui.healthDetail || !ui.healthProgress) return;
    const score = computeHealthScore(statuses);
    const label = score >= 85 ? 'Ausgezeichnet' : score >= 70 ? 'Gut' : score >= 50 ? 'Mittel' : 'Schlecht';
    ui.healthScore.textContent = String(score);
    ui.healthLabel.textContent = label;

    const detail = ['CO2', 'PM2.5', 'TVOC', 'rel. Feuchte']
      .filter((metric) => statuses[metric])
      .map((metric) => `${metricLabel(metric)} ${statuses[metric].label}`)
      .join(' • ');
    ui.healthDetail.textContent = detail || 'Werte werden geladen …';

    const dashoffset = CIRCUMFERENCE * (1 - score / 100);
    ui.healthProgress.setAttribute('stroke-dashoffset', dashoffset.toFixed(2));
  }

  function metricLabel(metric) {
    return METRIC_CONFIG[metric]?.label || metric;
  }

  function computeHealthScore(statuses) {
    let score = 100;

    const co2 = statuses.CO2 ? state.now?.CO2?.value : null;
    if (isFinite(co2)) {
      if (co2 > 2000) score -= 40;
      else if (co2 > 1500) score -= 25;
      else if (co2 > 1000) score -= 10;
    }

    const pm = state.now?.['PM2.5']?.value;
    if (isFinite(pm)) {
      if (pm > 55) score -= 35;
      else if (pm > 35) score -= 20;
      else if (pm > 15) score -= 10;
    }

    const tvoc = state.now?.TVOC?.value;
    if (isFinite(tvoc)) {
      if (tvoc > 1000) score -= 25;
      else if (tvoc > 300) score -= 15;
      else if (tvoc > 150) score -= 5;
    }

    const rh = state.now?.['rel. Feuchte']?.value;
    if (isFinite(rh)) {
      if (rh < 25 || rh > 65) score -= 15;
      else if (rh < 30 || rh > 60) score -= 10;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function updateStatusCards(data) {
    ui.statusCards.forEach((card, metric) => {
      const sample = data[metric];
      const valueEl = card.querySelector('.status-value');
      const unitEl = card.querySelector('.unit');
      const noteEl = card.querySelector('.status-note');
      const badge = card.querySelector('.badge');
      const textNode = ensureTextNode(valueEl);
      const config = METRIC_CONFIG[metric];

      if (!config) return;
      unitEl.textContent = config.unit;

      if (!sample || !isFinite(sample.value)) {
        if (textNode) textNode.textContent = '— ';
        if (noteEl) noteEl.textContent = 'Keine Daten verfügbar.';
        if (badge) {
          badge.dataset.tone = 'neutral';
          badge.textContent = 'Keine Daten';
        }
      } else {
        const status = determineStatus(metric, sample.value);
        if (textNode) textNode.textContent = `${formatNumber(sample.value, config.decimals)} `;
        if (noteEl) noteEl.textContent = status.note;
        if (badge) {
          badge.dataset.tone = status.tone || 'neutral';
          badge.textContent = status.label;
        }
      }
      card.classList.add('ready');
    });

    updatePressureCard(data);
  }

  function updatePressureCard(data) {
    const card = ui.statusCards.get('Luftdruck');
    if (!card) return;
    const sample = data['Luftdruck'];
    if (!sample || !isFinite(sample.value)) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const valueEl = card.querySelector('.status-value');
    const unitEl = card.querySelector('.unit');
    const noteEl = card.querySelector('.status-note');
    const trendEl = card.querySelector('.trend');
    const textNode = ensureTextNode(valueEl);
    if (textNode) {
      textNode.textContent = `${formatNumber(sample.value, METRIC_CONFIG['Luftdruck'].decimals)} `;
    }
    unitEl.textContent = METRIC_CONFIG['Luftdruck'].unit;
    if (trendEl) {
      const trend = state.pressureTrend;
      if (trend) {
        trendEl.textContent = `${trend.symbol} ${trend.text}`;
        if (noteEl) noteEl.textContent = trend.note;
      } else {
        trendEl.textContent = 'Trend wird ermittelt …';
        if (noteEl) noteEl.textContent = 'Daten sammeln …';
      }
    }
    card.classList.add('ready');
  }

  function updateCircadian(data) {
    if (!ui.circadianCard) return;
    const luxSample = data.Lux;
    const luxValue = luxSample && isFinite(luxSample.value) ? luxSample.value : null;
    const phase = resolveCircadianPhase();
    const evaluation = evaluateCircadian(luxValue, phase);

    ui.circadianPhase.textContent = phase.title;
    ui.circadianStatus.textContent = evaluation.status;
    ui.circadianTip.textContent = evaluation.tip;
    ui.luxNow.textContent = luxValue != null ? `${formatNumber(luxValue, 0)} lx` : '— lx';
    ui.luxTarget.textContent = `${phase.range[0]}–${phase.range[1]} lx`;
    ui.luxEval.dataset.tone = evaluation.tone;
    ui.luxEval.textContent = evaluation.label;

    ui.circadianCard.classList.add('ready');
  }

  function resolveCircadianPhase() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const phases = [
      { start: 6, end: 9, title: 'Aufwachen', range: [250, 500], tip: 'Helles Licht hilft beim Wachwerden.' },
      { start: 9, end: 17, title: 'Arbeiten', range: [500, 1000], tip: 'Klares, helles Licht unterstützt den Fokus.' },
      { start: 17, end: 20, title: 'Wind-down', range: [100, 300], tip: 'Etwas dimmen für einen entspannten Abend.' },
      { start: 20, end: 23, title: 'Vor Schlaf', range: [0, 100], tip: 'Nur noch sanftes Licht verwenden.' },
      { start: 23, end: 24, title: 'Schlaf', range: [0, 10], tip: 'Dunkelheit fördert die Regeneration.' },
      { start: 0, end: 6, title: 'Schlaf', range: [0, 10], tip: 'Lichtquellen minimieren.' }
    ];

    return phases.find((phase) => {
      if (phase.start <= phase.end) {
        return hour >= phase.start && hour < phase.end;
      }
      return hour >= phase.start || hour < phase.end;
    }) || phases[0];
  }

  function evaluateCircadian(lux, phase) {
    if (lux == null) {
      return { tone: 'neutral', label: 'keine Daten', status: 'Lichtpegel unbekannt', tip: 'Sensor überprüfen.' };
    }
    const [min, max] = phase.range;
    if (lux < min) {
      return { tone: 'mid', label: 'zu dunkel', status: 'Mehr Licht empfohlen', tip: phase.tip };
    }
    if (lux > max) {
      return { tone: 'mid', label: 'zu hell', status: 'Licht reduzieren', tip: phase.tip };
    }
    return { tone: 'good', label: 'ok', status: 'Circadian im Ziel', tip: phase.tip };
  }

  function formatNumber(value, decimals) {
    return Number(value).toLocaleString('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function buildChartShells() {
    CHART_DEFINITIONS.forEach((definition) => {
      const card = ui.chartCards.get(definition.key);
      const canvas = ui.chartCanvases.get(definition.key);
      if (!card || !canvas) return;
      if (definition.optional) {
        card.hidden = true;
      }
      const ctx = canvas.getContext('2d');
      const chart = new Chart(ctx, createChartConfig(definition));
      state.charts.set(definition.key, { chart, definition, card });
    });
  }

  function createChartConfig(definition) {
    const datasets = definition.metrics.map((metric, index) => ({
      label: METRIC_CONFIG[metric]?.label || metric,
      data: [],
      borderColor: definition.colors[index % definition.colors.length],
      backgroundColor: definition.colors[index % definition.colors.length],
      tension: 0.35,
      fill: false,
      pointRadius: 0,
      borderWidth: 2,
      spanGaps: true,
      segment: {
        borderDash: () => []
      },
      decimation: {
        enabled: true,
        algorithm: 'lttb',
        samples: definition.samples || state.range.samples
      }
    }));

    return {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#374151' } },
          tooltip: {
            callbacks: {
              label(context) {
                const metric = definition.metrics[context.datasetIndex];
                const cfg = METRIC_CONFIG[metric];
                const formatted = formatNumber(context.parsed.y, cfg?.decimals || 0);
                return `${context.dataset.label}: ${formatted} ${cfg?.unit || ''}`.trim();
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'hour', tooltipFormat: 'dd.MM.yyyy HH:mm' },
            ticks: { maxRotation: 0, maxTicksLimit: 6, color: '#9ca3af' },
            grid: { display: false, drawBorder: false },
            border: { display: false }
          },
          y: {
            title: { display: true, text: definition.yTitle, color: '#9ca3af' },
            ticks: { color: '#9ca3af' },
            grid: { display: false, drawBorder: false },
            border: { display: false },
            suggestedMin: definition.yBounds?.min,
            suggestedMax: definition.yBounds?.max
          }
        }
      }
    };
  }

  async function refreshCharts(force) {
    const tasks = [];
    state.charts.forEach((entry) => {
      tasks.push(loadChartData(entry, force));
    });
    await Promise.all(tasks);
  }

  async function loadChartData(entry, force) {
    const { chart, definition, card } = entry;
    const cacheKey = `${definition.key}_${state.range.range}`;
    if (!force && state.chartDataCache.has(cacheKey)) {
      const cached = state.chartDataCache.get(cacheKey);
      applyChartData(chart, definition, cached);
      const hasData = definition.metrics.some((metric) => (cached[metric] || []).length > 0);
      card.hidden = definition.optional && !hasData;
      if (!card.hidden) {
        card.classList.add('ready');
      }
      return;
    }

    const series = await fetchSeries(definition.metrics);
    const smoothed = smoothSeries(series);
    state.chartDataCache.set(cacheKey, smoothed);
    applyChartData(chart, definition, smoothed);
    const hasData = definition.metrics.some((metric) => (smoothed[metric] || []).length > 0);
    card.hidden = definition.optional && !hasData;
    if (!card.hidden) {
      card.classList.add('ready');
    }
  }

  async function fetchSeries(metrics) {
    const promises = metrics.map(async (metric) => {
      const params = new URLSearchParams({
        name: metric,
        range: state.range.range,
        step: state.range.step,
        win: state.range.win
      });
      const response = await fetch(`./api/series?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Fehler beim Laden der Serie ${metric}`);
      }
      const payload = await response.json();
      if (!payload || !payload.ok) {
        throw new Error(payload?.error || `Serie ${metric} ungültig`);
      }
      const values = normalizeSeriesValues(payload.data);
      const points = values
        .map((row) => ({ x: row[0] * 1000, y: Number(row[1]) }))
        .filter((point) => Number.isFinite(point.y));
      return [metric, points];
    });

    const entries = await Promise.all(promises);
    return Object.fromEntries(entries);
  }

  function normalizeSeriesValues(raw) {
    if (!raw) return [];
    const values = Array.isArray(raw?.values) ? raw.values : raw;
    if (!Array.isArray(values)) return [];

    const normalized = values
      .map((entry) => {
        if (!entry) return null;
        if (Array.isArray(entry) && entry.length >= 2) {
          return [Number(entry[0]), Number(entry[1])];
        }
        if (typeof entry === 'object') {
          const ts = 'x' in entry ? Number(entry.x) : Number(entry.ts);
          const val = 'y' in entry ? Number(entry.y) : Number(entry.value);
          if (Number.isFinite(ts) && Number.isFinite(val)) {
            return [ts, val];
          }
        }
        return null;
      })
      .filter((entry) => Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1]));
    const containsMilliseconds = normalized.some((entry) => entry[0] > 1e11);
    return containsMilliseconds
      ? normalized.map(([ts, val]) => [ts / 1000, val])
      : normalized;
  }

  function smoothSeries(series) {
    const result = {};
    for (const [metric, points] of Object.entries(series)) {
      const windowSize = Math.max(3, Math.round(points.length / 30));
      result[metric] = movingAverage(points, windowSize);
    }
    return result;
  }

  function movingAverage(points, windowSize) {
    if (points.length <= 2 || windowSize <= 2) return points;
    const smoothed = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < points.length; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(points.length - 1, i + half);
      const slice = points.slice(start, end + 1);
      const sum = slice.reduce((total, point) => total + point.y, 0);
      smoothed.push({ x: points[i].x, y: sum / slice.length });
    }
    return smoothed;
  }

  function applyChartData(chart, definition, data) {
    let maxY = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    definition.metrics.forEach((metric, index) => {
      const points = data[metric] || [];
      chart.data.datasets[index].data = points;
      chart.data.datasets[index].decimation.samples = state.range.samples;
      points.forEach((point) => {
        if (!point) return;
        const value = Number(point.y);
        if (!Number.isFinite(value)) return;
        if (value > maxY) maxY = value;
        if (value < minY) minY = value;
      });
    });
    const yScale = chart.options?.scales?.y;
    if (yScale) {
      const bounds = definition.yBounds || {};
      if (typeof bounds.min === 'number') {
        yScale.min = bounds.min;
        yScale.suggestedMin = bounds.min;
      } else if (Number.isFinite(minY)) {
        yScale.min = minY;
      } else {
        delete yScale.min;
        delete yScale.suggestedMin;
      }

      if (typeof bounds.max === 'number') {
        const safeMax = Number.isFinite(maxY) ? Math.max(bounds.max, maxY * 1.05) : bounds.max;
        yScale.max = safeMax;
        yScale.suggestedMax = bounds.max;
      } else if (Number.isFinite(maxY)) {
        yScale.max = maxY * 1.05;
        delete yScale.suggestedMax;
      } else {
        delete yScale.max;
        delete yScale.suggestedMax;
      }
    }
    chart.update('none');
  }

  async function refreshPressureTrend() {
    if (!state.now?.Luftdruck) return;
    if (Date.now() - state.lastPressureFetch < PRESSURE_REFRESH_MS) return;
    state.lastPressureFetch = Date.now();
    try {
      const params = new URLSearchParams({ name: 'Luftdruck', range: '3h', step: '15m', win: '30m' });
      const response = await fetch(`./api/series?${params.toString()}`);
      if (!response.ok) return;
      const payload = await response.json();
      const values = normalizeSeriesValues(payload?.data);
      if (values.length >= 2) {
        const first = Number(values[0][1]);
        const last = Number(values[values.length - 1][1]);
        if (isFinite(first) && isFinite(last)) {
          const diff = last - first;
          const symbol = diff > 0.3 ? '↑' : diff < -0.3 ? '↓' : '→';
          const text = diff > 0.3 ? 'steigend' : diff < -0.3 ? 'fallend' : 'stabil';
          const note = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} hPa in 3 h`;
          state.pressureTrend = { symbol, text, note };
          updatePressureCard(state.now || {});
        }
      }
    } catch (error) {
      console.warn('Druck-Trend nicht verfügbar', error);
    }
  }

  function checkAlerts(data) {
    const co2 = data.CO2?.value;
    if (!isFinite(co2)) return;
    if (co2 > 1500 && !state.alertFired) {
      state.alertFired = true;
      notify(`CO₂ zu hoch (${formatNumber(co2, 0)} ppm). Bitte lüften!`);
    }
    if (co2 <= 1300) {
      state.alertFired = false;
    }
  }

  function notify(message) {
    if (!('Notification' in window)) {
      showToast(message);
      return;
    }
    if (Notification.permission === 'granted') {
      try {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification('AirGuard Hinweis', {
            body: message,
            icon: './assets/logo.png',
            tag: 'airguard-alert'
          });
        });
      } catch (error) {
        console.warn('Notification fehlgeschlagen', error);
        showToast(message);
      }
    } else {
      showToast(message);
    }
  }

  function showToast(message) {
    if (!ui.toast || !ui.toastText) return;
    ui.toastText.textContent = message;
    ui.toast.hidden = false;
    window.clearTimeout(ui.toast._timer);
    ui.toast._timer = window.setTimeout(() => {
      ui.toast.hidden = true;
    }, 6000);
  }

  function hideToast() {
    if (!ui.toast) return;
    ui.toast.hidden = true;
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => console.info('Service Worker registriert'))
      .catch((error) => console.error('Service Worker Fehler', error));
  }

  function setupInstallPrompt() {
    if (!ui.installBtn) return;
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredPrompt = event;
      ui.installBtn.hidden = false;
    });

    ui.installBtn.addEventListener('click', async () => {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      const choice = await state.deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        showToast('AirGuard wurde installiert.');
      }
      state.deferredPrompt = null;
      ui.installBtn.hidden = true;
    });
  }

  function setupNotifications() {
    if (!ui.notifyBtn || !supportsNotification) return;
    if (Notification.permission === 'granted') {
      ui.notifyBtn.hidden = true;
      subscribeForPush().catch((error) => console.warn('Push Registrierung fehlgeschlagen', error));
    } else {
      ui.notifyBtn.hidden = false;
      ui.notifyBtn.addEventListener('click', async () => {
        try {
          const result = await Notification.requestPermission();
          if (result === 'granted') {
            ui.notifyBtn.hidden = true;
            showToast('Benachrichtigungen aktiviert.');
            subscribeForPush().catch((error) => console.warn('Push Registrierung fehlgeschlagen', error));
          } else {
            showToast('Benachrichtigungen nicht erlaubt.');
          }
        } catch (error) {
          console.warn('Notification-Fehler', error);
        }
      });
    }
  }

  async function subscribeForPush() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    if (!('pushManager' in registration)) return;
    try {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true
      });
      await fetch('./push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      await fetch('./push/test', { method: 'POST' });
    } catch (error) {
      console.warn('Push-Subscription fehlgeschlagen', error);
    }
  }

  function handleError(error) {
    console.error(error);
    showToast(typeof error === 'string' ? error : error?.message || 'Unbekannter Fehler');
  }
})();
