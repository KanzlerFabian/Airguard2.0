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
  const MAX_POINTS = 600;
  const CCT_RANGE = { min: 1800, max: 7000 };
  const LUX_RANGE = { min: 0, max: 1100 };

  const CIRCADIAN_PHASES = [
    {
      key: 'wake',
      title: 'Aufwachen',
      window: '06–09 Uhr',
      context: 'Morgen',
      cctRange: [4500, 6500],
      luxRange: [250, 500]
    },
    {
      key: 'work',
      title: 'Arbeiten',
      window: '09–17 Uhr',
      context: 'Fokus',
      cctRange: [5000, 6500],
      luxRange: [500, 1000]
    },
    {
      key: 'winddown',
      title: 'Wind-down',
      window: '17–20 Uhr',
      context: 'Abend',
      cctRange: [3000, 4000],
      luxRange: [100, 300]
    },
    {
      key: 'pre-sleep',
      title: 'Vor Schlaf',
      window: '20–23 Uhr',
      context: 'Vor dem Schlafen',
      cctRange: [2200, 3200],
      luxRange: [0, 100]
    },
    {
      key: 'sleep',
      title: 'Schlaf',
      window: '23–06 Uhr',
      context: 'Nacht',
      cctRange: [2000, 2700],
      luxRange: [0, 10]
    }
  ];

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
    Farbtemperatur: { unit: 'K', decimals: 0, label: 'CCT' },
    'PM1.0': { unit: 'µg/m³', decimals: 1, label: 'PM1.0' },
    PM10: { unit: 'µg/m³', decimals: 1, label: 'PM10' }
  };

  const CHART_DEFINITIONS = {
    CO2: {
      key: 'CO2',
      title: 'CO₂',
      metrics: ['CO2'],
      colors: ['#10b981'],
      yTitle: 'ppm',
      yBounds: { min: 0, max: 2500 }
    },
    PM: {
      key: 'PM',
      title: 'Feinstaub',
      sub: 'PM1.0 / PM2.5 / PM10',
      metrics: ['PM1.0', 'PM2.5', 'PM10'],
      colors: ['#06b6d4', '#3b82f6', '#0f766e'],
      yTitle: 'µg/m³',
      yBounds: { min: 0, max: 100 }
    },
    Temperatur: {
      key: 'Temperatur',
      title: 'Temperatur',
      metrics: ['Temperatur'],
      colors: ['#f97316'],
      yTitle: '°C',
      yBounds: { min: -10, max: 40 }
    },
    'rel. Feuchte': {
      key: 'rel. Feuchte',
      title: 'rel. Feuchte',
      metrics: ['rel. Feuchte'],
      colors: ['#06b6d4'],
      yTitle: '%',
      yBounds: { min: 0, max: 100 }
    },
    TVOC: {
      key: 'TVOC',
      title: 'TVOC',
      metrics: ['TVOC'],
      colors: ['#3b82f6'],
      yTitle: 'ppb',
      yBounds: { min: 0, max: 1000 }
    },
    Lux: {
      key: 'Lux',
      title: 'Beleuchtungsstärke',
      metrics: ['Lux'],
      colors: ['#facc15'],
      yTitle: 'lx',
      yBounds: { min: 0, max: 1200 }
    },
    Farbtemperatur: {
      key: 'Farbtemperatur',
      title: 'Farbtemperatur',
      metrics: ['Farbtemperatur'],
      colors: ['#38bdf8'],
      yTitle: 'K',
      yBounds: { min: 1800, max: 7000 }
    },
    Luftdruck: {
      key: 'Luftdruck',
      title: 'Luftdruck',
      metrics: ['Luftdruck'],
      colors: ['#a855f7'],
      yTitle: 'hPa',
      yBounds: { min: 950, max: 1050 },
      optional: true
    }
  };

  const METRIC_TO_CHART_KEY = {
    CO2: 'CO2',
    'PM1.0': 'PM',
    'PM2.5': 'PM',
    PM10: 'PM',
    TVOC: 'TVOC',
    Temperatur: 'Temperatur',
    'rel. Feuchte': 'rel. Feuchte',
    Lux: 'Lux',
    Farbtemperatur: 'Farbtemperatur',
    Luftdruck: 'Luftdruck'
  };

  const HERO_METRICS = ['CO2', 'PM2.5', 'TVOC', 'rel. Feuchte'];

  const state = {
    range: TIME_RANGES['24h'],
    chartDataCache: new Map(),
    timers: [],
    now: null,
    lastPressureFetch: 0,
    pressureTrend: null,
    deferredPrompt: null,
    notifyReady: supportsNotification && Notification.permission !== 'granted',
    alertFired: false,
    offline: !navigator.onLine,
    lastUpdatedTs: null,
    sparklines: new Map(),
    modalChart: null,
    modalMetric: null,
    modalRangeKey: '24h'
  };

  const ui = {
    heroCards: new Map(),
    statusCards: new Map(),
    lastUpdated: null,
    healthScore: null,
    healthLabel: null,
    healthDetail: null,
    healthProgress: null,
    offlineIndicator: null,
    circadianCard: null,
    circadianPhase: null,
    circadianStatus: null,
    circadianTip: null,
    circadianCycle: null,
    circadianCycleMarker: null,
    circadianCycleLabel: null,
    cctNow: null,
    cctTarget: null,
    cctEval: null,
    barCct: null,
    luxNow: null,
    luxTarget: null,
    luxEval: null,
    barLux: null,
    installBtn: null,
    notifyBtn: null,
    toast: null,
    toastText: null,
    toastClose: null,
    modalRoot: null,
    modalTitle: null,
    modalSub: null,
    modalCanvas: null,
    modalTabs: [],
    modalCloseButtons: []
  };

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    registerServiceWorker();
    setupInstallPrompt();
    setupNotifications();
    updateOfflineState();
    window.addEventListener('online', updateOfflineState);
    window.addEventListener('offline', updateOfflineState);
    refreshAll(true).catch(handleError);
    setupTimers();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshAll(false).catch(handleError);
      }
    });
    document.addEventListener('keydown', handleGlobalKeydown);
  });

  function cacheElements() {
    ui.lastUpdated = document.getElementById('last-updated');
    ui.healthScore = document.getElementById('health-score');
    ui.healthLabel = document.getElementById('health-label');
    ui.healthDetail = document.getElementById('health-detail');
    ui.healthProgress = document.querySelector('.health-progress');
    ui.offlineIndicator = document.getElementById('offline-indicator');
    ui.circadianCard = document.querySelector('.circadian-card');
    ui.circadianPhase = document.querySelector('.circadian-phase');
    ui.circadianStatus = document.querySelector('.circadian-status');
    ui.circadianTip = document.querySelector('.circadian-tip');
    ui.circadianCycle = document.querySelector('.circadian-cycle');
    ui.circadianCycleMarker = document.querySelector('.cycle-marker');
    ui.circadianCycleLabel = document.getElementById('circadian-cycle-label');
    ui.cctNow = document.getElementById('cct-now');
    ui.cctTarget = document.getElementById('cct-target');
    ui.cctEval = document.getElementById('cct-eval');
    ui.barCct = document.querySelector('.bar-track[data-kind="cct"]');
    ui.luxNow = document.getElementById('lux-now');
    ui.luxTarget = document.getElementById('lux-target');
    ui.luxEval = document.getElementById('lux-eval');
    ui.barLux = document.querySelector('.bar-track[data-kind="lux"]');
    ui.installBtn = document.getElementById('install-btn');
    ui.notifyBtn = document.getElementById('notify-btn');
    ui.toast = document.querySelector('.toast');
    ui.toastText = ui.toast?.querySelector('.toast-text') || null;
    ui.toastClose = ui.toast?.querySelector('.toast-close') || null;

    const miniCards = document.querySelectorAll('.mini-card');
    miniCards.forEach((card) => {
      const metric = card.getAttribute('data-metric');
      if (!metric) return;
      ui.heroCards.set(metric, card);
      createSparkline(metric, card);
      setupCardModalTrigger(card, metric);
    });

    const statusCards = document.querySelectorAll('.status-card');
    statusCards.forEach((card) => {
      const metric = card.getAttribute('data-metric');
      if (!metric) return;
      ui.statusCards.set(metric, card);
      setupCardModalTrigger(card, metric);
    });

    ui.modalRoot = document.getElementById('chart-modal');
    ui.modalTitle = document.getElementById('chart-modal-title');
    ui.modalSub = document.getElementById('chart-modal-sub');
    ui.modalCanvas = document.getElementById('chart-modal-canvas');
    ui.modalTabs = Array.from(document.querySelectorAll('.modal-tab'));
    ui.modalCloseButtons = Array.from(document.querySelectorAll('[data-close="true"]'));

    ui.modalTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.getAttribute('aria-selected') === 'true') return;
        ui.modalTabs.forEach((other) => other.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        const key = tab.getAttribute('data-range');
        state.modalRangeKey = key in TIME_RANGES ? key : '24h';
        if (state.modalMetric) {
          loadModalChart(state.modalMetric, true).catch(handleError);
        }
      });
    });

    ui.modalCloseButtons.forEach((button) => {
      button.addEventListener('click', closeChartModal);
    });

    if (ui.modalRoot) {
      ui.modalRoot.addEventListener('click', (event) => {
        if (event.target?.dataset?.close === 'true') {
          closeChartModal();
        }
      });
    }

    if (ui.toastClose) {
      ui.toastClose.addEventListener('click', hideToast);
    }

    updateCircadianCycle(resolveCircadianPhase());
  }

  function updateOfflineState() {
    state.offline = !navigator.onLine;
    if (!ui.offlineIndicator) return;
    if (state.offline) {
      const ts = state.lastUpdatedTs;
      const text = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unbekannt';
      ui.offlineIndicator.textContent = `Offline – letzte Daten von ${text}`;
      ui.offlineIndicator.hidden = false;
    } else {
      ui.offlineIndicator.hidden = true;
    }
  }

  function setupCardModalTrigger(card, metric) {
    if (!card || !metric) return;
    const definition = getDefinitionForMetric(metric);
    if (!definition) return;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => openChartModal(metric));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openChartModal(metric);
      }
    });
  }

  function createSparkline(metric, card) {
    if (!card) return;
    const canvas = card.querySelector('.mini-chart canvas');
    if (!canvas) return;
    const definition = getDefinitionForMetric(metric);
    if (!definition) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const color = definition.colors?.[0] || '#0ea5e9';
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            data: [],
            borderColor: color,
            backgroundColor: colorWithAlpha(color, 0.2),
            tension: 0.4,
            fill: 'start',
            pointRadius: 0,
            borderWidth: 2,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        scales: {
          x: {
            type: 'time',
            display: false
          },
          y: {
            display: false
          }
        }
      }
    });
    state.sparklines.set(metric, chart);
  }

  function setupTimers() {
    state.timers.push(setInterval(() => refreshNow().catch(handleError), NOW_REFRESH_MS));
    state.timers.push(setInterval(() => preloadSeries(true).catch(handleError), CHART_REFRESH_MS));
    state.timers.push(setInterval(() => refreshPressureTrend().catch(handleError), PRESSURE_REFRESH_MS));
    state.timers.push(setInterval(() => updateCircadianCycle(resolveCircadianPhase()), NOW_REFRESH_MS));
    window.addEventListener('beforeunload', () => {
      state.timers.forEach((timer) => clearInterval(timer));
    });
  }

  async function refreshAll(initial) {
    await Promise.all([refreshNow(), preloadSeries(true), refreshPressureTrend()]);
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
    const merged = { ...(state.now || {}) };
    for (const [metric, sample] of Object.entries(data)) {
      merged[metric] = sample;
    }
    state.now = merged;
    const displayData = state.now;
    updateTimestamp(payload.ts || Date.now());
    updateHero(displayData);
    updateStatusCards(displayData);
    updateCircadian(displayData);
    checkAlerts(displayData);
    if (displayData['Luftdruck']) {
      refreshPressureTrend().catch((error) => console.warn('Drucktrend Fehler', error));
    }
  }

  function normalizeNowData(raw) {
    const mapped = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
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
    if (!isNaN(date.getTime())) {
      state.lastUpdatedTs = date.getTime();
    }
    updateOfflineState();
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
        card.dataset.intent = 'neutral';
        return;
      }
      const status = determineStatus(metric, sample.value);
      card.querySelector('.mini-value').textContent = formatNumber(sample.value, config.decimals);
      card.querySelector('.mini-unit').textContent = config.unit;
      card.classList.add('ready');
      card.dataset.intent = status.intent || status.tone || 'neutral';
      statuses[metric] = status;
    });

    updateHealthCard(statuses);
  }

  function determineStatus(metric, value) {
    if (!isFinite(value)) {
      return { tone: 'neutral', intent: 'neutral', label: 'n/v', note: '', tip: '' };
    }

    switch (metric) {
      case 'CO2':
        if (value <= 800) {
          return buildStatus('excellent', 'Hervorragend', 'Luft sehr frisch.', 'Kein Handlungsbedarf.');
        }
        if (value <= 1000) {
          return buildStatus('good', 'Gut', 'Werte stabil.', 'Regelmäßig weiter lüften.');
        }
        if (value <= 1500) {
          return buildStatus('elevated', 'Erhöht', 'Konzentration nimmt ab.', 'Jetzt lüften empfohlen.');
        }
        return buildStatus('poor', 'Schlecht', 'Sehr hohe CO₂-Belastung.', 'Fenster öffnen oder Lüftung aktivieren.');
      case 'PM2.5':
        if (value <= 10) {
          return buildStatus('excellent', 'Hervorragend', 'Partikel kaum messbar.', 'Saubere Luft – weiter so.');
        }
        if (value <= 15) {
          return buildStatus('good', 'Gut', 'Feinstaub niedrig.', 'Sanft lüften, um es so zu halten.');
        }
        if (value <= 35) {
          return buildStatus('elevated', 'Mittel', 'Belastung steigt leicht.', 'Luftreiniger prüfen & lüften.');
        }
        return buildStatus('poor', 'Schlecht', 'Hohe Partikelbelastung.', 'Sofort lüften oder Filter aktivieren.');
      case 'TVOC':
        if (value <= 200) {
          return buildStatus('excellent', 'Hervorragend', 'Kaum VOC-Belastung.', 'Keine Aktion nötig.');
        }
        if (value <= 400) {
          return buildStatus('good', 'Gut', 'Werte unkritisch.', 'Regelmäßig lüften hält die Luft frisch.');
        }
        if (value <= 1000) {
          return buildStatus('elevated', 'Erhöht', 'Flüchtige Stoffe nehmen zu.', 'Quellen prüfen & lüften.');
        }
        return buildStatus('poor', 'Schlecht', 'Hohe VOC-Belastung.', 'Sofort lüften und Quellen entfernen.');
      case 'Temperatur':
        if (value < 18) {
          return buildStatus('cool', 'Kühl', 'Raumtemperatur niedrig.', 'Heizung leicht erhöhen.');
        }
        if (value < 20) {
          return buildStatus('cool', 'Frisch', 'Etwas kühl.', 'Sanft nachheizen möglich.');
        }
        if (value <= 23) {
          return buildStatus('good', 'Komfort', 'Wohlfühlbereich erreicht.', 'Perfekt für Alltag & Fokus.');
        }
        if (value <= 26) {
          return buildStatus('elevated', 'Warm', 'Leicht erhöht.', 'Leicht abkühlen oder lüften.');
        }
        return buildStatus('warm', 'Sehr warm', 'Hitze belastet den Schlaf.', 'Aktiv kühlen oder beschatten.');
      case 'rel. Feuchte':
        if (value < 30) {
          return buildStatus('dry', 'Trocken', 'Luft zu trocken.', 'Luft befeuchten oder Pflanzen gießen.');
        }
        if (value <= 60) {
          return buildStatus('good', 'Ok', 'Optimale Luftfeuchte.', 'Weiter regelmäßig lüften.');
        }
        if (value <= 70) {
          return buildStatus('humid', 'Feucht', 'Leicht erhöht.', 'Stoßlüften und trocknen.');
        }
        return buildStatus('poor', 'Sehr feucht', 'Schimmelrisiko steigt.', 'Entfeuchten oder stärker lüften.');
      case 'Lux':
        if (value < 50) {
          return buildStatus('cool', 'Sehr dunkel', 'Kaum Beleuchtung vorhanden.', 'Licht erhöhen oder Vorhänge öffnen.');
        }
        if (value <= 400) {
          return buildStatus('good', 'Angenehm', 'Helles, aber sanftes Licht.', 'Beleuchtung beibehalten.');
        }
        if (value <= 800) {
          return buildStatus('elevated', 'Hell', 'Sehr kräftiges Licht.', 'Blendungen reduzieren oder dimmen.');
        }
        return buildStatus('warm', 'Sehr hell', 'Extrem helle Umgebung.', 'Dimmen oder indirektes Licht nutzen.');
      case 'Farbtemperatur':
        if (value < 2600) {
          return buildStatus('warm', 'Sehr warm', 'Licht wirkt stark warm.', 'Etwas kühler einstellen für Fokus.');
        }
        if (value < 3200) {
          return buildStatus('warm', 'Warm', 'Gemütliches Warmweiß.', 'Ideal für Abend & Entspannung.');
        }
        if (value <= 5000) {
          return buildStatus('good', 'Neutral', 'Ausgeglichenes Weißlicht.', 'Perfekt für Alltag & Arbeit.');
        }
        if (value <= 6500) {
          return buildStatus('cool', 'Frisch', 'Kühles, aktivierendes Licht.', 'Gut für konzentriertes Arbeiten.');
        }
        return buildStatus('cool', 'Sehr kühl', 'Licht wirkt sehr kalt.', 'Für Wohlbefinden etwas wärmer stellen.');
      default:
        return { tone: 'neutral', intent: 'neutral', label: '', note: '', tip: '' };
    }
  }

  function buildStatus(intent, label, note, tip) {
    return { intent, tone: intent, label, note, tip };
  }

  function updateHealthCard(statuses) {
    if (!ui.healthScore || !ui.healthLabel || !ui.healthDetail || !ui.healthProgress) return;
    const score = computeHealthScore();
    const tone = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 30 ? 'elevated' : 'poor';
    const label = score >= 80 ? 'Ausgezeichnet' : score >= 60 ? 'Gut' : score >= 30 ? 'Mittel' : 'Schlecht';
    ui.healthScore.textContent = String(score);
    ui.healthLabel.textContent = label;
    ui.healthLabel.style.color = toneToColor(tone);

    const detail = ['CO2', 'PM2.5', 'TVOC', 'rel. Feuchte']
      .filter((metric) => statuses[metric])
      .map((metric) => `${metricLabel(metric)} ${statuses[metric].label}`)
      .join(' • ');
    ui.healthDetail.textContent = detail || 'Werte werden geladen …';

    const dashoffset = CIRCUMFERENCE * (1 - score / 100);
    ui.healthProgress.setAttribute('stroke-dashoffset', dashoffset.toFixed(2));
    ui.healthProgress.style.stroke = tone === 'excellent' ? 'url(#health-gradient)' : toneToColor(tone);
  }

  function metricLabel(metric) {
    return METRIC_CONFIG[metric]?.label || metric;
  }

  function computeHealthScore() {
    const weights = { CO2: 0.35, 'PM2.5': 0.3, 'rel. Feuchte': 0.2, TVOC: 0.15 };
    let weightedScore = 0;
    let weightSum = 0;
    for (const [metric, weight] of Object.entries(weights)) {
      const value = state.now?.[metric]?.value;
      if (!isFinite(value)) continue;
      const metricScore = evaluateMetricScore(metric, value);
      weightedScore += metricScore * weight;
      weightSum += weight;
    }
    if (weightSum === 0) return 0;
    return Math.max(0, Math.min(100, Math.round(weightedScore / weightSum)));
  }

  function evaluateMetricScore(metric, value) {
    switch (metric) {
      case 'CO2':
        if (value <= 800) return 100;
        if (value <= 1000) return 85;
        if (value <= 1500) return 55;
        if (value <= 2000) return 35;
        return 10;
      case 'PM2.5':
        if (value <= 10) return 100;
        if (value <= 15) return 85;
        if (value <= 35) return 55;
        if (value <= 55) return 35;
        return 10;
      case 'TVOC':
        if (value <= 200) return 100;
        if (value <= 400) return 80;
        if (value <= 1000) return 50;
        if (value <= 1500) return 30;
        return 10;
      case 'rel. Feuchte': {
        if (value >= 30 && value <= 60) return 100;
        if ((value >= 27 && value < 30) || (value > 60 && value <= 65)) return 70;
        if ((value >= 24 && value < 27) || (value > 65 && value <= 70)) return 45;
        return 20;
      }
      default:
        return 50;
    }
  }

  function toneToColor(tone) {
    const palette = {
      excellent: '#10b981',
      good: '#22c55e',
      elevated: '#f59e0b',
      dry: '#f59e0b',
      humid: '#06b6d4',
      poor: '#ef4444',
      warm: '#f97316',
      cool: '#3b82f6',
      neutral: '#94a3b8'
    };
    return palette[tone] || '#06b6d4';
  }

  function computeTrend(metric) {
    const mapping = getTrendMapping(metric);
    if (!mapping) {
      return null;
    }
    const cacheKey = `${mapping.chartKey}_${state.range.range}`;
    const cached = state.chartDataCache.get(cacheKey);
    const series = cached?.[mapping.metricKey];
    if (!Array.isArray(series) || series.length < 2) {
      return { symbol: '→', text: '→' };
    }
    const last = series[series.length - 1];
    if (!last || !isFinite(last.y)) {
      return { symbol: '→', text: '→' };
    }
    const thresholdMs = 30 * 60 * 1000;
    let reference = series[0];
    for (let index = series.length - 2; index >= 0; index--) {
      const candidate = series[index];
      if (!candidate) continue;
      reference = candidate;
      if (last.x - candidate.x >= thresholdMs) {
        break;
      }
    }
    if (!reference || !isFinite(reference.y)) {
      return { symbol: '→', text: '→' };
    }
    const diff = last.y - reference.y;
    const threshold = getTrendThreshold(metric);
    let symbol = '→';
    if (diff > threshold) symbol = '↑';
    else if (diff < -threshold) symbol = '↓';
    return { symbol, text: symbol };
  }

  function getTrendMapping(metric) {
    const chartKey = METRIC_TO_CHART_KEY[metric];
    if (!chartKey) return null;
    return { chartKey, metricKey: metric };
  }

  function getTrendThreshold(metric) {
    const thresholds = {
      CO2: 50,
      'PM2.5': 3,
      TVOC: 40,
      Temperatur: 0.3,
      'rel. Feuchte': 1.5,
      Lux: 40,
      Farbtemperatur: 120
    };
    return thresholds[metric] ?? 0.1;
  }

  function colorWithAlpha(color, alpha) {
    if (!color) return `rgba(6, 182, 212, ${alpha})`;
    if (color.startsWith('#')) {
      const hex = color.replace('#', '');
      if (hex.length === 3) {
        const r = parseInt(hex[0], 16) * 17;
        const g = parseInt(hex[1], 16) * 17;
        const b = parseInt(hex[2], 16) * 17;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
    return color;
  }

  function updateStatusCards(data) {
    ui.statusCards.forEach((card, metric) => {
      if (metric === 'Luftdruck') {
        return;
      }
      const sample = data[metric];
      const valueEl = card.querySelector('.status-value .value');
      const unitEl = card.querySelector('.unit');
      const noteEl = card.querySelector('.status-note');
      const tipEl = card.querySelector('.status-tip');
      const badge = card.querySelector('.badge');
      const trendEl = card.querySelector('.trend');
      const config = METRIC_CONFIG[metric];

      if (!config) return;
      unitEl.textContent = config.unit;

      if (!sample || !isFinite(sample.value)) {
        if (valueEl) valueEl.textContent = '—';
        if (noteEl) noteEl.textContent = 'Keine Daten verfügbar.';
        if (tipEl) tipEl.textContent = '';
        if (badge) {
          badge.dataset.tone = 'neutral';
          badge.textContent = 'Keine Daten';
        }
        card.dataset.intent = 'neutral';
        if (trendEl) trendEl.textContent = '—';
      } else {
        const status = determineStatus(metric, sample.value);
        if (valueEl) valueEl.textContent = formatNumber(sample.value, config.decimals);
        if (noteEl) noteEl.textContent = status.note;
        if (tipEl) tipEl.textContent = status.tip;
        if (badge) {
          badge.dataset.tone = status.tone || 'neutral';
          badge.textContent = status.label;
        }
        card.dataset.intent = status.intent || status.tone || 'neutral';
        const trend = computeTrend(metric);
        if (trendEl) {
          trendEl.textContent = trend?.text || trend?.symbol || '→';
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
    const valueEl = card.querySelector('.status-value .value');
    const unitEl = card.querySelector('.unit');
    const noteEl = card.querySelector('.status-note');
    const trendEl = card.querySelector('.trend');
    const tipEl = card.querySelector('.status-tip');
    const badge = card.querySelector('.badge');
    if (valueEl) {
      valueEl.textContent = formatNumber(sample.value, METRIC_CONFIG['Luftdruck'].decimals);
    }
    unitEl.textContent = METRIC_CONFIG['Luftdruck'].unit;
    const trend = state.pressureTrend;
    if (trendEl) {
      trendEl.textContent = trend ? `${trend.symbol} ${trend.text}` : 'Trend wird ermittelt …';
    }
    if (noteEl) {
      noteEl.textContent = trend ? trend.note : 'Daten sammeln …';
    }
    if (tipEl) {
      tipEl.textContent = trend ? 'Trend aktualisiert alle 3 h.' : '';
    }
    if (badge) {
      badge.dataset.tone = 'neutral';
      badge.textContent = 'Trend';
    }
    card.dataset.intent = 'neutral';
    card.classList.add('ready');
  }

  function updateCircadian(data) {
    if (!ui.circadianCard) return;
    const cctSample = data.Farbtemperatur;
    const cctValue = cctSample && isFinite(cctSample.value) ? cctSample.value : null;
    const luxSample = data.Lux;
    const luxValue = luxSample && isFinite(luxSample.value) ? luxSample.value : null;
    const phase = resolveCircadianPhase();
    const evaluation = evaluateCircadian(cctValue, luxValue, phase);

    ui.circadianPhase.textContent = `${phase.title} • ${phase.window}`;
    ui.circadianStatus.textContent = evaluation.cctStatus;
    ui.circadianTip.textContent = evaluation.tip;
    ui.cctNow.textContent = cctValue != null ? `${formatNumber(cctValue, 0)} K` : '— K';
    ui.cctTarget.textContent = `Ziel ${phase.cctRange[0]}–${phase.cctRange[1]} K`;
    ui.cctEval.dataset.tone = evaluation.cctTone;
    ui.cctEval.textContent = evaluation.cctLabel;
    ui.luxNow.textContent = luxValue != null ? `${formatNumber(luxValue, 0)} lx` : '— lx';
    ui.luxTarget.textContent = `Ziel ${phase.luxRange[0]}–${phase.luxRange[1]} lx`;
    ui.luxEval.dataset.tone = evaluation.luxTone;
    ui.luxEval.textContent = evaluation.luxLabel;
    if (ui.barCct) {
      ui.barCct.setAttribute('data-range-label', `Ziel ${phase.cctRange[0]}–${phase.cctRange[1]} K`);
    }
    if (ui.barLux) {
      ui.barLux.setAttribute('data-range-label', `Ziel ${phase.luxRange[0]}–${phase.luxRange[1]} lx`);
    }

    updateBarTrack(ui.barCct, cctValue, phase.cctRange, CCT_RANGE, evaluation.cctTone);
    updateBarTrack(ui.barLux, luxValue, phase.luxRange, LUX_RANGE, evaluation.luxTone);
    updateCircadianCycle(phase);

    ui.circadianCard.dataset.intent = evaluation.cctTone;
    ui.circadianCard.classList.add('ready');
  }

  function updateCircadianCycle(phase) {
    if (!ui.circadianCycle) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const percent = (minutes / (24 * 60)) * 100;
    ui.circadianCycle.style.setProperty('--cycle-pos', `${clamp(percent, 0, 100)}%`);
    if (ui.circadianCycleLabel) {
      ui.circadianCycleLabel.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (ui.circadianCycleMarker) {
      ui.circadianCycleMarker.style.left = `${clamp(percent, 0, 100)}%`;
      const isDaytime = minutes >= 360 && minutes < 1080;
      ui.circadianCycleMarker.dataset.period = isDaytime ? 'day' : 'night';
      ui.circadianCycleMarker.textContent = isDaytime ? '☀' : '☾';
    }
    if (phase?.key) {
      ui.circadianCycle.dataset.phase = phase.key;
    }
  }

  function resolveCircadianPhase() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    return (
      CIRCADIAN_PHASES.find((phase, index) => {
        const next = CIRCADIAN_PHASES[(index + 1) % CIRCADIAN_PHASES.length];
        const start = parsePhaseStart(phase.window);
        const end = parsePhaseStart(next.window);
        if (start <= end) {
          return hour >= start && hour < end;
        }
        return hour >= start || hour < end;
      }) || CIRCADIAN_PHASES[0]
    );
  }

  function evaluateCircadian(cct, lux, phase) {
    const [cctMin, cctMax] = phase.cctRange;
    const [luxMin, luxMax] = phase.luxRange;
    let cctLabel;
    let cctTone;
    let cctStatus;
    let actionText;

    if (cct == null) {
      cctLabel = 'keine Daten';
      cctTone = 'neutral';
      cctStatus = 'CCT unbekannt';
      actionText = 'CCT Sensor prüfen';
    } else if (cct < cctMin) {
      cctLabel = 'zu kalt';
      cctTone = 'cool';
      cctStatus = 'CCT zu kalt';
      actionText = 'wärmer stellen';
    } else if (cct > cctMax) {
      cctLabel = 'zu warm';
      cctTone = 'warm';
      cctStatus = 'CCT zu warm';
      actionText = 'kühler einstellen';
    } else {
      cctLabel = 'im Ziel';
      cctTone = 'excellent';
      cctStatus = 'CCT im Ziel';
      actionText = 'Licht passt';
    }

    let luxLabel;
    let luxTone;
    if (lux == null) {
      luxLabel = 'keine Daten';
      luxTone = 'neutral';
    } else if (lux < luxMin) {
      luxLabel = 'zu dunkel';
      luxTone = 'cool';
    } else if (lux > luxMax) {
      luxLabel = 'zu hell';
      luxTone = 'warm';
    } else {
      luxLabel = 'ok';
      luxTone = 'excellent';
    }

    const luxText = lux != null
      ? `Lux ${formatNumber(lux, 0)} → Ziel ${luxMin}–${luxMax}`
      : 'Lux Sensor prüfen';
    const tip = `${phase.context}: ${actionText}${luxText ? `, ${luxText}` : ''}`;

    return {
      cctStatus,
      cctLabel,
      cctTone,
      luxLabel,
      luxTone,
      tip
    };
  }

  function updateBarTrack(track, value, targetRange, bounds, tone) {
    if (!track) return;
    const span = bounds.max - bounds.min;
    const startPercent = ((targetRange[0] - bounds.min) / span) * 100;
    const endPercent = ((targetRange[1] - bounds.min) / span) * 100;
    track.style.setProperty('--target-start', `${clamp(startPercent, 0, 100)}%`);
    track.style.setProperty('--target-end', `${clamp(endPercent, 0, 100)}%`);
    if (value == null || !isFinite(value)) {
      track.dataset.state = 'hidden';
      track.style.setProperty('--marker-pos', '-999%');
    } else {
      const markerPercent = ((value - bounds.min) / span) * 100;
      track.style.setProperty('--marker-pos', `${clamp(markerPercent, 0, 100)}%`);
      track.dataset.state = 'visible';
    }
    track.dataset.intent = tone || 'neutral';
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function parsePhaseStart(windowLabel) {
    const match = windowLabel.match(/^(\d{2})/);
    if (!match) return 0;
    return Number(match[1]);
  }

  function formatNumber(value, decimals) {
    return Number(value).toLocaleString('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  async function preloadSeries(force) {
    const definitions = Object.values(CHART_DEFINITIONS).filter((definition) => !definition.optional);
    await Promise.all(definitions.map((definition) => ensureSeries(definition, state.range, force)));
    updateSparklines();
    if (state.now) {
      updateStatusCards(state.now);
    }
  }

  async function ensureSeries(definition, range, force) {
    const cacheKey = `${definition.key}_${range.range}`;
    if (!force && state.chartDataCache.has(cacheKey)) {
      return state.chartDataCache.get(cacheKey);
    }
    const series = await fetchSeries(definition.metrics, range);
    const smoothed = smoothSeries(series);
    state.chartDataCache.set(cacheKey, smoothed);
    return smoothed;
  }

  async function fetchSeries(metrics, range = state.range) {
    const promises = metrics.map(async (metric) => {
      const params = new URLSearchParams({
        name: metric,
        range: range.range,
        step: range.step,
        win: range.win
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
      return [metric, limitPoints(points)];
    });

    const entries = await Promise.all(promises);
    return Object.fromEntries(entries);
  }

  function updateSparklines() {
    HERO_METRICS.forEach((metric) => {
      const sparkline = state.sparklines.get(metric);
      if (!sparkline) return;
      const definition = getDefinitionForMetric(metric);
      if (!definition) return;
      const cacheKey = `${definition.key}_${state.range.range}`;
      const cached = state.chartDataCache.get(cacheKey);
      if (!cached) return;
      const data = cached[metric] || [];
      sparkline.data.datasets[0].data = data;
      sparkline.update('none');
      const tone = ui.heroCards.get(metric)?.dataset?.intent || 'neutral';
      const color = definition.colors?.[0];
      if (color) {
        sparkline.data.datasets[0].borderColor = color;
        sparkline.data.datasets[0].backgroundColor = colorWithAlpha(color, 0.2);
      }
      if (tone === 'warm') {
        sparkline.data.datasets[0].borderColor = '#f97316';
      }
    });
  }

  function updateModalTabs(activeKey) {
    const key = activeKey in TIME_RANGES ? activeKey : '24h';
    ui.modalTabs.forEach((tab) => {
      tab.setAttribute('aria-selected', tab.getAttribute('data-range') === key ? 'true' : 'false');
    });
  }

  function getDefinitionForMetric(metric) {
    const chartKey = METRIC_TO_CHART_KEY[metric];
    if (!chartKey) return null;
    return CHART_DEFINITIONS[chartKey] || null;
  }

  function openChartModal(metric) {
    const definition = getDefinitionForMetric(metric);
    if (!definition || !ui.modalRoot || !ui.modalCanvas) return;
    state.modalMetric = metric;
    updateModalTabs(state.modalRangeKey);
    ui.modalTitle.textContent = definition.title || metricLabel(metric);
    ui.modalSub.textContent = 'Lade Daten …';
    ui.modalRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    loadModalChart(metric, false).catch(handleError);
  }

  function closeChartModal() {
    if (!ui.modalRoot) return;
    ui.modalRoot.hidden = true;
    document.body.style.overflow = '';
    if (state.modalChart) {
      state.modalChart.destroy();
      state.modalChart = null;
    }
    state.modalMetric = null;
  }

  async function loadModalChart(metric, force) {
    const definition = getDefinitionForMetric(metric);
    if (!definition || !ui.modalCanvas) return;
    const rangeKey = state.modalRangeKey in TIME_RANGES ? state.modalRangeKey : '24h';
    const range = TIME_RANGES[rangeKey];
    const data = await ensureSeries(definition, range, force);
    if (state.modalMetric !== metric) {
      // The user switched or closed the modal before this request resolved.
      // Abort so we don't render stale data under the new metric's heading.
      return;
    }
    renderModalChart(definition, data, range);
  }

  function renderModalChart(definition, data, range) {
    if (!ui.modalCanvas) return;
    const ctx = ui.modalCanvas.getContext('2d');
    if (!ctx) return;
    if (state.modalChart) {
      state.modalChart.destroy();
    }
    const datasets = definition.metrics.map((metric, index) => ({
      label: METRIC_CONFIG[metric]?.label || metric,
      data: data[metric] || [],
      borderColor: definition.colors[index % definition.colors.length],
      backgroundColor: colorWithAlpha(definition.colors[index % definition.colors.length], 0.12),
      tension: 0.35,
      fill: 'start',
      pointRadius: 0,
      borderWidth: 2,
      spanGaps: true
    }));

    const timeUnit = range.range === '24h' ? 'hour' : range.range === '7d' ? 'day' : 'week';

    state.modalChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#475569', boxWidth: 12, boxHeight: 12 } },
          tooltip: {
            callbacks: {
              label(context) {
                const metricKey = definition.metrics[context.datasetIndex];
                const cfg = METRIC_CONFIG[metricKey];
                const formatted = formatNumber(context.parsed.y, cfg?.decimals || 0);
                return `${context.dataset.label}: ${formatted} ${cfg?.unit || ''}`.trim();
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: timeUnit, tooltipFormat: 'dd.MM.yyyy HH:mm' },
            ticks: { maxRotation: 0, maxTicksLimit: 6, color: '#94a3b8' },
            grid: { display: false, drawBorder: false },
            border: { display: false }
          },
          y: {
            title: { display: true, text: definition.yTitle, color: '#9ca3af' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(148, 163, 184, 0.15)', drawBorder: false },
            border: { display: false },
            suggestedMin: definition.yBounds?.min,
            suggestedMax: definition.yBounds?.max
          }
        }
      }
    });

    const label = METRIC_CONFIG[state.modalMetric || definition.metrics[0]]?.label || definition.title || definition.key;
    ui.modalTitle.textContent = label;
    const subParts = [range.label];
    if (definition.sub) {
      subParts.push(definition.sub);
    } else if (definition.yTitle) {
      subParts.push(definition.yTitle);
    }
    ui.modalSub.textContent = subParts.join(' • ');
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape') {
      closeChartModal();
    }
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
      const windowSize = resolveWindowSize(points.length);
      result[metric] = movingAverage(points, windowSize);
    }
    return result;
  }

  function resolveWindowSize(length) {
    if (length > 400) return 7;
    if (length > 120) return 6;
    return 5;
  }

  function limitPoints(points) {
    if (!Array.isArray(points) || points.length <= MAX_POINTS) {
      return points;
    }
    const step = Math.ceil(points.length / MAX_POINTS);
    const limited = [];
    for (let index = 0; index < points.length; index += step) {
      limited.push(points[index]);
    }
    const lastPoint = points[points.length - 1];
    if (limited[limited.length - 1] !== lastPoint) {
      limited.push(lastPoint);
    }
    return limited;
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
