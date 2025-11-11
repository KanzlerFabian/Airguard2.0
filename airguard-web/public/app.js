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
  const targetGuidePlugin = {
    id: 'targetGuides',
    afterDraw(chart, _args, opts) {
      const guides = opts?.guides;
      if (!Array.isArray(guides) || guides.length === 0) return;
      const { ctx, chartArea } = chart;
      const yScale = chart.scales?.y;
      if (!ctx || !chartArea || !yScale) return;
      const left = chartArea.left;
      const right = chartArea.right;
      ctx.save();
      guides.forEach((guide) => {
        const color = guide.color || STATUS_TONES.good;
        const label = guide.label;
        if (guide.min != null && guide.max != null) {
          const top = yScale.getPixelForValue(guide.min);
          const bottom = yScale.getPixelForValue(guide.max);
          const startY = Math.min(top, bottom);
          const height = Math.max(Math.abs(bottom - top), 2);
          ctx.fillStyle = colorWithAlpha(color, 0.12);
          ctx.fillRect(left, startY, right - left, height);
          if (label) {
            ctx.fillStyle = color;
            ctx.font = '12px "Inter", sans-serif';
            ctx.fillText(label, left + 8, startY + 14);
          }
        } else if (guide.value != null) {
          const y = yScale.getPixelForValue(guide.value);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          if (label) {
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.font = '12px "Inter", sans-serif';
            ctx.fillText(label, left + 8, Math.max(chartArea.top + 12, y - 6));
          }
        }
      });
      ctx.restore();
    }
  };

  const safeInteractionPlugin = {
    id: 'safeInteraction',
    afterInit(chart) {
      const hasData = chartHasUsableData(chart);
      syncChartInteractionState(chart, hasData);
      if (!hasData) {
        clearActiveElements(chart);
      }
    },
    afterDatasetsUpdate(chart) {
      const hasData = chartHasUsableData(chart);
      syncChartInteractionState(chart, hasData);
      if (!hasData) {
        clearActiveElements(chart);
      }
    },
    beforeEvent(chart, args) {
      const hasData = chartHasUsableData(chart);
      if (!hasData) {
        syncChartInteractionState(chart, false);
        clearActiveElements(chart);
        if (args && typeof args === 'object') {
          args.cancel = true;
        }
        return;
      }
      const active = typeof chart?.getActiveElements === 'function' ? chart.getActiveElements() : [];
      if (!Array.isArray(active) || active.length === 0) {
        resetTooltipState(chart);
      }
    }
  };

  function chartHasUsableData(chart) {
    const datasets = chart?.data?.datasets;
    if (!Array.isArray(datasets) || datasets.length === 0) {
      return false;
    }
    return datasets.some((dataset) => {
      const data = Array.isArray(dataset?.data) ? dataset.data : [];
      return data.some((point) => {
        if (point == null) return false;
        if (typeof point === 'number') {
          return Number.isFinite(point);
        }
        if (typeof point === 'object') {
          const value = 'y' in point ? Number(point.y) : 'value' in point ? Number(point.value) : NaN;
          return Number.isFinite(value);
        }
        return false;
      });
    });
  }

  function ensureInteractionBackups(chart) {
    if (!chart) return;
    if (!chart.$_safeInteraction) {
      chart.$_safeInteraction = {
        events: Array.isArray(chart.options?.events) ? chart.options.events.slice() : null,
        tooltip: chart.options?.plugins?.tooltip && Object.prototype.hasOwnProperty.call(chart.options.plugins.tooltip, 'enabled')
          ? chart.options.plugins.tooltip.enabled
          : undefined,
        preferredTooltip: undefined
      };
    }
  }

  function syncChartInteractionState(chart, hasData) {
    if (!chart || !chart.options) return;
    ensureInteractionBackups(chart);
    const store = chart.$_safeInteraction;
    const options = chart.options;
    options.plugins = options.plugins || {};
    options.plugins.tooltip = options.plugins.tooltip || {};
    if (hasData) {
      if (store.events) {
        options.events = store.events.slice();
      } else {
        delete options.events;
      }
      const target = store.preferredTooltip ?? store.tooltip;
      if (target === undefined) {
        delete options.plugins.tooltip.enabled;
      } else {
        options.plugins.tooltip.enabled = target;
      }
    } else {
      if (Array.isArray(options.events) && options.events.length) {
        store.events = options.events.slice();
      }
      options.events = [];
      if (store.preferredTooltip === undefined) {
        store.preferredTooltip = options.plugins.tooltip.enabled;
      }
      options.plugins.tooltip.enabled = false;
    }
  }

  function clearActiveElements(chart) {
    if (!chart) return;
    if (typeof chart.setActiveElements === 'function') {
      try {
        chart.setActiveElements([]);
      } catch (error) {
        console.debug('Aktive Elemente konnten nicht zurückgesetzt werden', error);
      }
    }
    resetTooltipState(chart);
  }

  function resetTooltipState(chart) {
    if (!chart?.tooltip || typeof chart.tooltip.setActiveElements !== 'function') {
      return;
    }
    try {
      chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    } catch (error) {
      console.debug('Tooltip konnte nicht zurückgesetzt werden', error);
    }
  }

  function recordTooltipPreference(chart, enabled) {
    if (!chart) return;
    ensureInteractionBackups(chart);
    if (chart.$_safeInteraction) {
      chart.$_safeInteraction.preferredTooltip = enabled;
    }
  }

  Chart.register(targetGuidePlugin, safeInteractionPlugin);
  Chart.defaults.font.family = "'Inter','Segoe UI',system-ui,sans-serif";
  Chart.defaults.color = '#6b7280';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.position = 'bottom';
  Chart.defaults.plugins.tooltip.mode = 'index';
  Chart.defaults.plugins.tooltip.intersect = false;

  if (Chart?.Tooltip?.positioners) {
    Chart.Tooltip.positioners.clamped = function (items) {
      if (!items || !items.length) return null;
      const pos = Chart.Tooltip.positioners.average(items);
      if (!pos) return pos;
      const { chart } = items[0];
      const area = chart?.chartArea;
      if (!area) return pos;
      const margin = 12;
      return {
        x: clamp(pos.x, area.left + margin, area.right - margin),
        y: clamp(pos.y, area.top + margin, area.bottom - margin)
      };
    };
    Chart.defaults.plugins.tooltip.position = 'clamped';
    Chart.defaults.plugins.tooltip.displayColors = false;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.92)';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.caretSize = 6;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
  }

  if (Chart?.Tooltip) {
    const tooltipProto = Chart.Tooltip?.prototype;
    if (!tooltipProto) {
      console.info('Tooltip patch übersprungen: Prototyp nicht verfügbar.');
    } else {
      const originalHandleEvent = typeof tooltipProto.handleEvent === 'function'
        ? tooltipProto.handleEvent
        : null;
      tooltipProto.handleEvent = function patchedHandleEvent(event, ...args) {
        const chart = this?.chart;
        const active = typeof chart?.getActiveElements === 'function' ? chart.getActiveElements() : [];
        const hasActive = Array.isArray(active) && active.length > 0;
        if (!hasActive) {
          this._active = [];
          this.opacity = 0;
          return false;
        }
        if (this.caretX == null || this.caretY == null) {
          return false;
        }
        if (!originalHandleEvent) {
          return false;
        }
        return originalHandleEvent.call(this, event, ...args);
      };

      if (typeof tooltipProto._positionChanged === 'function') {
        const originalPositionChanged = tooltipProto._positionChanged;
        tooltipProto._positionChanged = function patchedPositionChanged(previous, caretPosition) {
          const chart = this?.chart;
          const active = typeof chart?.getActiveElements === 'function' ? chart.getActiveElements() : [];
          const hasActive = Array.isArray(active) && active.length > 0;
          if (!hasActive) {
            return false;
          }
          if (this.caretX == null || this.caretY == null) {
            return false;
          }
          return originalPositionChanged.call(this, previous, caretPosition);
        };
      }
    }
  }

  const scheduledChartUpdates = new WeakMap();

  function scheduleChartUpdate(chart, mode = 'none') {
    if (!chart || typeof chart.update !== 'function') return;
    const pending = scheduledChartUpdates.get(chart);
    if (pending) {
      pending.mode = mode === 'none' ? pending.mode : mode;
      return;
    }
    const entry = { mode };
    scheduledChartUpdates.set(chart, entry);
    queueMicrotask(() => {
      scheduledChartUpdates.delete(chart);
      try {
        chart.update(entry.mode);
      } catch (error) {
        console.warn('Chart-Update fehlgeschlagen', error);
      }
    });
  }

  function createConfigStore(initialState = {}) {
    let state = { ...initialState };
    const listeners = new Set();
    let notifying = false;

    function get() {
      return state;
    }

    function assign(patch) {
      if (!patch || typeof patch !== 'object') {
        return state;
      }
      const next = { ...state };
      let changed = false;
      Object.entries(patch).forEach(([key, value]) => {
        if (next[key] !== value) {
          next[key] = value;
          changed = true;
        }
      });
      if (!changed) return state;
      state = next;
      queueNotify();
      return state;
    }

    function queueNotify() {
      if (notifying) return;
      notifying = true;
      queueMicrotask(() => {
        notifying = false;
        const snapshot = state;
        listeners.forEach((listener) => {
          try {
            listener(snapshot);
          } catch (error) {
            console.warn('Konfigurations-Listener Fehler', error);
          }
        });
      });
    }

    function subscribe(listener, emitImmediately = false) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      listeners.add(listener);
      if (emitImmediately) {
        try {
          listener(state);
        } catch (error) {
          console.warn('Konfigurations-Listener Fehler', error);
        }
      }
      return () => listeners.delete(listener);
    }

    return { get, assign, subscribe };
  }

  const NARROW_SPACE = '\u202f';
  const CIRCUMFERENCE = 339.292;
  const NOW_REFRESH_MS = 60_000;
  const CHART_REFRESH_MS = 300_000;
  const PRESSURE_REFRESH_MS = 600_000;
  const MAX_POINTS = 600;
  const CCT_RANGE = { min: 1800, max: 7000 };
  const LUX_RANGE = { min: 0, max: 1100 };
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

  const CIRCADIAN_SCALE_BANDS = {
    lux: [
      { label: 'Dunkel', min: 0, max: 100, tone: 'poor', display: `< 100${NARROW_SPACE}lx` },
      { label: 'OK', min: 100, max: 500, tone: 'good', display: `100–500${NARROW_SPACE}lx` },
      { label: 'Ziel', min: 500, max: 1000, tone: 'excellent', display: `500–1 000${NARROW_SPACE}lx` },
      { label: 'Sehr hell', min: 1500, max: 2000, tone: 'poor', display: `> 1 500${NARROW_SPACE}lx` }
    ],
    cct: [
      { label: 'Abend', min: 2200, max: 3200, tone: 'elevated', display: `2 200–3 200${NARROW_SPACE}K` },
      { label: 'Neutral', min: 3800, max: 5200, tone: 'good', display: `3 800–5 200${NARROW_SPACE}K` },
      { label: 'Aktiv', min: 5200, max: 6000, tone: 'excellent', display: `5 200–6 000${NARROW_SPACE}K` },
      { label: 'Sehr kühl', min: 6000, max: 6500, tone: 'poor', display: `6 000–6 500${NARROW_SPACE}K` }
    ]
  };

  const CIRCADIAN_SCALE_LIMITS = {
    lux: { min: 0, max: 2000 },
    cct: { min: 2200, max: 6500 }
  };

  const TIME_RANGES = {
    '24h': { label: '24 h', range: '24h', step: '120s', win: '10m', samples: 48 },
    '7d': { label: '7 Tage', range: '7d', step: '15m', win: '45m', samples: 72 },
    '30d': { label: '30 Tage', range: '30d', step: '30m', win: '2h', samples: 96 }
  };

  const SPARKLINE_RANGE_KEY = '24h';
  const FETCH_RETRY_DELAYS = [500, 1000, 2000];
  const EMPTY_SERIES_RETRY_DELAYS = [500, 1000];
  const RANGE_RULES = {
    '24h': { stepMin: 120, stepMax: 300, windowMin: 240 },
    '7d': { stepMin: 600, stepMax: 900, windowMin: 1800 },
    '30d': { stepMin: 1800, stepMax: 3600, windowMin: 3600 }
  };
  const ENABLE_FETCH_DEBUG = (() => {
    try {
      if (window?.AIRGUARD_DEBUG_FETCH) return true;
      if (window?.localStorage?.getItem('airguard:debugFetch') === '1') return true;
      if (window?.sessionStorage?.getItem('airguard:debugFetch') === '1') return true;
    } catch (error) {
      /* no-op */
    }
    return false;
  })();

  function logFetchDebug(...args) {
    if (!ENABLE_FETCH_DEBUG) return;
    try {
      console.debug('[fetch]', ...args);
    } catch (error) {
      console.log('[fetch]', ...args);
    }
  }

  const SERIES_NAME_ALIASES = new Map([
    ['Temperatur', ['Temperatur', 'temp_final', 'temperature_final', 'temp']],
    ['CO2', ['CO2', 'co2', 'co2_ppm']],
    ['TVOC', ['TVOC', 'tvoc']],
    ['Lux', ['Lux', 'lux']],
    ['Farbtemperatur', ['Farbtemperatur', 'cct', 'cct_k']],
    ['rel. Feuchte', ['rel. Feuchte', 'rel_feuchte', 'humidity']],
    ['PM1.0', ['PM1.0', 'pm1', 'pm_1']],
    ['PM2.5', ['PM2.5', 'pm2_5', 'pm25']],
    ['PM10', ['PM10', 'pm10']]
  ]);

  const modalConfig = createConfigStore({
    metric: null,
    rangeKey: '24h',
    loading: false,
    error: null,
    empty: false
  });

  const METRIC_CONFIG = {
    CO2: { unit: 'ppm', decimals: 0, label: 'CO₂' },
    'PM1.0': { unit: 'µg/m³', decimals: 1, label: 'PM1' },
    'PM2.5': { unit: 'µg/m³', decimals: 1, label: 'PM2.5' },
    PM10: { unit: 'µg/m³', decimals: 1, label: 'PM10' },
    TVOC: { unit: 'ppb', decimals: 0, label: 'TVOC' },
    Temperatur: { unit: '°C', decimals: 1, label: 'Temperatur' },
    'rel. Feuchte': { unit: '%', decimals: 0, label: 'rel. Feuchte' },
    Lux: { unit: 'lx', decimals: 0, label: 'Lux' },
    Luftdruck: { unit: 'hPa', decimals: 1, label: 'Luftdruck' },
    Farbtemperatur: { unit: 'K', decimals: 0, label: 'CCT' }
  };

  const NOW_KEY_ALIASES = new Map([
    ['temperatur', 'Temperatur'],
    ['temperature', 'Temperatur'],
    ['temperature_final', 'Temperatur'],
    ['temperatur__bme_kalibriert_', 'Temperatur'],
    ['temperatur_kalibriert', 'Temperatur'],
    ['temp', 'Temperatur'],
    ['temp_final', 'Temperatur'],
    ['co2', 'CO2'],
    ['co2_ppm', 'CO2'],
    ['pm1', 'PM1.0'],
    ['pm1.0', 'PM1.0'],
    ['pm 1', 'PM1.0'],
    ['pm10', 'PM10'],
    ['pm 10', 'PM10'],
    ['pm25', 'PM2.5'],
    ['pm2_5', 'PM2.5'],
    ['tvoc', 'TVOC'],
    ['voc', 'TVOC'],
    ['humidity', 'rel. Feuchte'],
    ['rel_feuchte', 'rel. Feuchte'],
    ['pressure_hpa', 'Luftdruck'],
    ['pressure', 'Luftdruck'],
    ['lux', 'Lux'],
    ['cct', 'Farbtemperatur'],
    ['cct_k', 'Farbtemperatur']
  ]);

  const STATUS_TONES = {
    excellent: '#16a34a',
    optimal: '#16a34a',
    good: '#0ea5e9',
    elevated: '#facc15',
    warning: '#facc15',
    poor: '#ef4444',
    critical: '#ef4444',
    neutral: '#94a3b8'
  };

  const STATUS_LABELS = {
    excellent: 'Hervorragend',
    optimal: 'Hervorragend',
    good: 'Gut',
    elevated: 'Erhöht',
    warning: 'Erhöht',
    poor: 'Schlecht',
    critical: 'Schlecht',
    neutral: 'Neutral'
  };

  const SCALE_TONES = { ...STATUS_TONES };

  const VALUE_SCALE_PRESETS = {
    CO2: {
      unit: 'ppm',
      min: 400,
      max: 2000,
      segments: [
        { from: 400, to: 800, label: 'Optimal', tone: 'excellent' },
        { from: 800, to: 1000, label: 'Stabil', tone: 'good' },
        { from: 1000, to: 1400, label: 'Lüften', tone: 'elevated' },
        { from: 1400, to: 2000, label: 'Alarm', tone: 'poor' }
      ],
      ticks: [{ at: 400 }, { at: 800 }, { at: 1000 }, { at: 1400 }, { at: 2000 }]
    },
    Temperatur: {
      unit: '°C',
      min: 16,
      max: 30,
      segments: [
        { from: 16, to: 19, label: 'Kühl', tone: 'elevated', detail: `< 19${NARROW_SPACE}°C` },
        { from: 19, to: 22, label: 'Komfort', tone: 'excellent' },
        { from: 22, to: 28, label: 'Warm', tone: 'elevated' },
        { from: 28, to: 30, label: 'Heiß', tone: 'poor', detail: `≥ 30${NARROW_SPACE}°C` }
      ],
      ticks: [{ at: 16 }, { at: 19 }, { at: 22 }, { at: 25 }, { at: 28 }, { at: 30 }]
    },
    'Luftdruck': {
      unit: 'hPa',
      min: 960,
      max: 1040,
      segments: [
        { from: 960, to: 980, label: 'Tiefdruck', tone: 'elevated' },
        { from: 980, to: 1005, label: 'Neutral', tone: 'excellent' },
        { from: 1005, to: 1030, label: 'Hoch', tone: 'good' },
        { from: 1030, to: 1040, label: 'Sehr hoch', tone: 'excellent', detail: `≥ 1${NARROW_SPACE}030${NARROW_SPACE}hPa` }
      ],
      ticks: [{ at: 960 }, { at: 980 }, { at: 1005 }, { at: 1030 }, { at: 1040 }]
    },
    'rel. Feuchte': {
      unit: '%',
      min: 20,
      max: 80,
      segments: [
        { from: 20, to: 35, label: 'Trocken', tone: 'poor' },
        { from: 35, to: 40, label: 'Übergang', tone: 'elevated' },
        { from: 40, to: 55, label: 'Wohlfühl', tone: 'excellent' },
        { from: 55, to: 60, label: 'Übergang', tone: 'elevated' },
        { from: 60, to: 80, label: 'Feucht/Nass', tone: 'poor' }
      ],
      ticks: [{ at: 20 }, { at: 35 }, { at: 40 }, { at: 55 }, { at: 60 }, { at: 80 }]
    }
  };

  const METRIC_INSIGHTS = {
    CO2: {
      sections: [
        { title: 'Bedeutung', text: 'CO₂ zeigt, wie verbraucht die Raumluft ist und ob ausreichend Frischluft vorhanden ist.' },
        {
          title: 'Gesunde Werte',
          text: '400–800 ppm optimal, 800–1000 ppm stabil, 1000–1400 ppm Lüften einplanen, ab 1400 ppm Alarm.'
        },
        {
          title: 'Auswirkungen',
          text: 'Steigt CO₂ über 1000 ppm, sinken Konzentration und Wohlbefinden; ab 1400 ppm drohen Kopfschmerzen und Müdigkeit.'
        },
        {
          title: 'Verbesserung',
          text: 'Regelmäßig querlüften (5–10 Minuten) oder Lüftungssystem aktivieren – besonders bei mehreren Personen im Raum.'
        }
      ],
      scale: {
        unit: 'ppm',
        min: 400,
        max: 2000,
        caption: 'Bewertung orientiert sich an Innenraumempfehlungen für CO₂.',
        bands: [
          { label: 'Optimal', min: 400, max: 800, tone: 'excellent' },
          { label: 'Stabil', min: 800, max: 1000, tone: 'good' },
          { label: 'Lüften', min: 1000, max: 1400, tone: 'elevated' },
          { label: 'Alarm', min: 1400, max: 2000, tone: 'poor' }
        ]
      }
    },
    'PM2.5': {
      sections: [
        { title: 'Bedeutung', text: 'Feinstaub besteht aus winzigen Partikeln, die tief in die Lunge gelangen.' },
        { title: 'Gesunde Werte', text: 'Unter 5 µg/m³ optimal, bis 12 µg/m³ gut.' },
        { title: 'Auswirkungen', text: 'Langfristige Belastung kann Atemwege reizen und Entzündungen fördern.' },
        { title: 'Verbesserung', text: 'Innenquellen vermeiden (Kerzen, Kochen, Staub), Luftreiniger mit HEPA-Filter verwenden.' }
      ],
      scale: {
        unit: 'µg/m³',
        min: 0,
        max: 60,
        caption: 'Grenzwerte angelehnt an WHO-Empfehlungen für Feinstaub.',
        stops: [
          { value: 5, label: 'Rein', tone: 'excellent' },
          { value: 12, label: 'Okay', tone: 'good' },
          { value: 25, label: 'Belastet', tone: 'elevated' },
          { value: 50, label: 'Kritisch', tone: 'poor' }
        ]
      }
    },
    'PM1.0': {
      sections: [
        {
          title: 'Bedeutung',
          text: 'PM1 bezeichnet Feinstaubpartikel ≤ 1 µm. Diese sehr kleinen Partikel können tief in die Lunge gelangen.'
        },
        {
          title: 'Gesunde Werte',
          text: '≤ 5 µg/m³ optimal, ≤ 12 µg/m³ gut, ≤ 35 µg/m³ erhöht, > 35 µg/m³ hoch.'
        },
        {
          title: 'Auswirkungen',
          text: 'Längere Belastung kann Atemwege reizen; empfindliche Personen reagieren früher auf erhöhte Werte.'
        },
        {
          title: 'Verbesserung',
          text: 'Innenquellen meiden (Kerzen, Kochen, Staub), regelmäßig lüften und bei Bedarf HEPA-Luftreiniger einsetzen.'
        }
      ],
      scale: {
        unit: 'µg/m³',
        min: 0,
        max: 60,
        caption: 'Bewertung orientiert sich an Leitwerten für PM1 in Innenräumen.',
        bands: [
          { label: 'Optimal', min: 0, max: 5, tone: 'excellent' },
          { label: 'Gut', min: 5, max: 12, tone: 'good' },
          { label: 'Erhöht', min: 12, max: 35, tone: 'elevated' },
          { label: 'Schlecht', min: 35, max: 60, tone: 'poor' }
        ]
      }
    },
    PM10: {
      sections: [
        {
          title: 'Bedeutung',
          text: 'PM10 umfasst Partikel ≤ 10 µm – typischerweise Staub, Pollen oder aufgewirbelte Ablagerungen.'
        },
        {
          title: 'Gesunde Werte',
          text: '≤ 20 µg/m³ optimal, ≤ 40 µg/m³ gut, ≤ 60 µg/m³ erhöht, > 100 µg/m³ hoch.'
        },
        {
          title: 'Auswirkungen',
          text: 'Kann Augen und Atemwege reizen; hohe Werte machen Pollenlasten spürbar.'
        },
        {
          title: 'Verbesserung',
          text: 'Lüften nach Außensituation abstimmen, Staubquellen reduzieren und bei Bedarf Luftreiniger nutzen.'
        }
      ],
      scale: {
        unit: 'µg/m³',
        min: 0,
        max: 120,
        caption: 'Bewertung orientiert sich an Innenraum-Richtwerten für PM10.',
        bands: [
          { label: 'Optimal', min: 0, max: 20, tone: 'excellent' },
          { label: 'Gut', min: 20, max: 40, tone: 'good' },
          { label: 'Erhöht', min: 40, max: 60, tone: 'elevated' },
          { label: 'Schlecht', min: 60, max: 120, tone: 'poor', display: `> 100${NARROW_SPACE}µg/m³` }
        ]
      }
    },
    TVOC: {
      sections: [
        { title: 'Bedeutung', text: 'TVOCs entstehen durch Ausdünstungen aus Möbeln, Farben, Reinigern oder Parfums.' },
        { title: 'Gesunde Werte', text: 'Unter 150 ppb ideal, bis 300 ppb gut.' },
        { title: 'Auswirkungen', text: 'Hohe Werte können Kopfschmerzen, Reizungen oder Schwindel verursachen.' },
        { title: 'Verbesserung', text: 'Regelmäßig lüften, Duft- und Chemikalienquellen reduzieren.' }
      ],
      scale: {
        unit: 'ppb',
        min: 0,
        max: 1200,
        caption: 'Bewertung orientiert sich an Innenraum-Leitwerten für VOC.',
        stops: [
          { value: 150, label: 'Niedrig', tone: 'excellent' },
          { value: 300, label: 'Unauffällig', tone: 'good' },
          { value: 600, label: 'Ansteigen', tone: 'elevated' },
          { value: 1000, label: 'Hoch', tone: 'poor' }
        ]
      }
    },
    Temperatur: {
      sections: [
        { title: 'Bedeutung', text: 'Raumtemperatur beeinflusst direkt das Wohlbefinden, die Konzentration und den Schlaf.' },
        {
          title: 'Gesunde Werte',
          text: '19–22 °C Komfort, darunter kühl, 22–28 °C warm und ab 30 °C deutlich zu heiß.'
        },
        { title: 'Auswirkungen', text: 'Zu kalt: Unbehagen, trockene Luft. Zu warm: Müdigkeit, sinkende Leistungsfähigkeit.' },
        { title: 'Verbesserung', text: 'Heizen, Beschatten oder Lüften, um die Komfortzone zu halten; Schlafzimmer kühler, Arbeitsräume wärmer.' }
      ],
      scale: {
        unit: '°C',
        min: 16,
        max: 30,
        caption: 'Bewertung orientiert sich an Empfehlungen für Innenraumtemperaturen.',
        bands: [
          { label: 'Kühl', min: 16, max: 19, tone: 'elevated', display: `< 19${NARROW_SPACE}°C` },
          { label: 'Komfort', min: 19, max: 22, tone: 'excellent' },
          { label: 'Warm', min: 22, max: 28, tone: 'elevated' },
          { label: 'Heiß', min: 28, max: 30, tone: 'poor', display: `≥ 30${NARROW_SPACE}°C` }
        ]
      }
    },
    'rel. Feuchte': {
      sections: [
        { title: 'Bedeutung', text: 'Gibt an, wie viel Wasserdampf die Luft enthält – wichtig für Wohlbefinden und Schimmelprävention.' },
        { title: 'Gesunde Werte', text: '40–55 % ideal, 35–40 % leicht trocken, über 60 % deutlich feucht.' },
        { title: 'Auswirkungen', text: 'Unter 35 % trockene Schleimhäute; über 60 % Schimmelgefahr.' },
        { title: 'Verbesserung', text: 'Luftbefeuchter oder Pflanzen bei Trockenheit, Stoßlüften oder Entfeuchter bei hoher Feuchte.' }
      ],
      scale: {
        unit: '%',
        min: 20,
        max: 80,
        caption: 'Komfortband nach Innenraumempfehlungen für relative Feuchte.',
        bands: [
          { label: 'Trocken', min: 20, max: 35, tone: 'poor' },
          { label: 'Übergang', min: 35, max: 40, tone: 'elevated' },
          { label: 'Wohlfühl', min: 40, max: 55, tone: 'excellent' },
          { label: 'Übergang', min: 55, max: 60, tone: 'elevated' },
          { label: 'Feucht/Nass', min: 60, max: 80, tone: 'poor' }
        ]
      }
    },
    Lux: {
      sections: [
        {
          title: 'Bedeutung',
          text: 'Lux beschreibt die Beleuchtungsstärke. Sie steuert Wachheit am Tag und Entspannung am Abend.'
        },
        {
          title: 'Gesunde Werte',
          text: 'Morgens und tagsüber 500–1 000 lx für Aktivität, abends 50–300 lx zur Vorbereitung auf den Schlaf.'
        },
        {
          title: 'Auswirkungen',
          text: 'Zu dunkles Licht macht müde und reduziert Fokus; zu helles Licht kann blenden und den circadianen Rhythmus stören.'
        },
        {
          title: 'Verbesserung',
          text: 'Tagsüber möglichst hell und indirekt beleuchten, abends dimmen und warmeres Licht wählen; Blendung vermeiden.'
        }
      ],
      scale: {
        unit: 'lx',
        min: 0,
        max: 1800,
        caption: 'Skala orientiert sich an circadianen Zielbereichen für Lichtintensität.',
        stops: [
          { value: 100, label: 'Dämmerig', tone: 'elevated' },
          { value: 350, label: 'Komfort', tone: 'excellent' },
          { value: 800, label: 'Aktiv', tone: 'good' },
          { value: 1500, label: 'Blendung', tone: 'poor' }
        ]
      }
    },
    Farbtemperatur: {
      sections: [
        {
          title: 'Bedeutung',
          text: 'Die Farbtemperatur zeigt, ob Licht warm oder kalt wirkt und beeinflusst Aktivierung und Entspannung im Tagesverlauf.'
        },
        {
          title: 'Gesunde Werte',
          text: 'Morgen: 5 000–6 000 K, Tag: 4 000–5 000 K, Abend: 2 700–3 500 K.'
        },
        {
          title: 'Auswirkungen',
          text: 'Zu kühles Abendlicht kann den Schlaf verzögern, zu warmes Tageslicht verringert Fokus und Wachheit.'
        },
        {
          title: 'Verbesserung',
          text: 'Tagsüber neutral bis kühles Licht nutzen, abends warmes Licht einsetzen; Mischlicht vermeiden und Leuchten gezielt ausrichten.'
        }
      ],
      scale: {
        unit: 'K',
        min: 1800,
        max: 6800,
        caption: 'Skala spiegelt die circadiane Empfehlung für Lichtfarbe wider.',
        stops: [
          { value: 3200, label: 'Abend', tone: 'elevated' },
          { value: 4500, label: 'Neutral', tone: 'excellent' },
          { value: 5500, label: 'Tag', tone: 'good' },
          { value: 6500, label: 'Sehr kühl', tone: 'poor' }
        ]
      }
    },
    Luftdruck: {
      sections: [
        { title: 'Bedeutung', text: 'Luftdruck schwankt mit dem Wetter und beeinflusst Kreislauf und Wohlbefinden.' },
        { title: 'Gesunde Werte', text: '980–1030 hPa normal, darunter Tiefdruck, darüber Hochdruck.' },
        { title: 'Auswirkungen', text: 'Sinkender Druck kann Kopfschmerzen oder Wetterfühligkeit auslösen.' },
        { title: 'Verbesserung', text: 'Keine direkte Steuerung möglich – dient zur Beobachtung von Wettertrends.' }
      ],
      scale: {
        unit: 'hPa',
        min: 960,
        max: 1040,
        caption: 'Typischer Bereich für den mitteleuropäischen Luftdruck.',
        bands: [
          { label: 'Tiefdruck', min: 960, max: 980, tone: 'elevated' },
          { label: 'Neutral', min: 980, max: 1005, tone: 'excellent' },
          { label: 'Hoch', min: 1005, max: 1030, tone: 'good' },
          { label: 'Sehr hoch', min: 1030, max: 1040, tone: 'excellent', display: `≥ 1 030${NARROW_SPACE}hPa` }
        ]
      }
    }
  };

  const TARGET_GUIDES = {
    CO2: [{ value: 800, unit: 'ppm', label: 'Ziel 800 ppm' }],
    'PM2.5': [{ value: 12, unit: 'µg/m³', label: 'WHO 12 µg/m³' }],
    TVOC: [{ value: 300, unit: 'ppb', label: 'Ziel 300 ppb' }],
    Temperatur: [{ min: 20, max: 24, unit: '°C', label: 'Komfort 20–24 °C' }],
    'rel. Feuchte': [{ min: 40, max: 55, unit: '%', label: 'Komfort 40–55 %' }],
    Lux: [{ dynamic: 'lux', unit: 'lx' }],
    Farbtemperatur: [{ dynamic: 'cct', unit: 'K' }],
    Luftdruck: [{ value: 1013, unit: 'hPa', label: 'Referenz 1013 hPa' }]
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

  const HERO_METRICS = ['CO2', 'PM2.5', 'PM1.0', 'PM10', 'TVOC', 'rel. Feuchte'];

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
    modalResizeObserver: null,
    modalResizeTarget: null,
    modalResizeTimer: 0,
    modalResizeActive: false,
    modalLayoutFrame: 0,
    activeModalRoot: null,
    activeModalContent: null,
    activeModalReturnFocus: null,
    bodyScrollLock: null,
    circadianCharts: { lux: null, cct: null },
    modalRequestToken: 0,
    modalAbortController: null
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
    pwaStatusBadge: null,
    toast: null,
    toastText: null,
    toastClose: null,
    modalRoot: null,
    modalContent: null,
    modalHeader: null,
    modalTitle: null,
    modalSub: null,
    modalCanvas: null,
    modalTabList: null,
    modalTabs: [],
    modalCloseButtons: [],
    modalCurrent: null,
    modalCurrentValue: null,
    modalCurrentUnit: null,
    modalCurrentLabel: null,
    modalInsight: null,
    modalScale: null,
    modalScaleSvg: null,
    modalScaleCaption: null,
    modalState: null,
    modalStateText: null,
    modalRetry: null,
    circadianModal: null,
    circadianModalContent: null,
    circadianModalStatus: null,
    circadianModalSummary: null,
    circadianModalLuxValue: null,
    circadianModalCctValue: null,
    circadianLuxCanvas: null,
    circadianCctCanvas: null,
    circadianScaleSegments: new Map(),
    circadianScaleLabels: new Map(),
    circadianScaleMarkers: new Map(),
    circadianScaleValues: new Map(),
    circadianModalCloseButtons: []
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
    ui.pwaStatusBadge = document.getElementById('pwa-status-badge');
    ui.toast = document.querySelector('.toast');
    ui.toastText = ui.toast?.querySelector('.toast-text') || null;
    ui.toastClose = ui.toast?.querySelector('.toast-close') || null;

    if (ui.circadianCard) {
      ui.circadianCard.tabIndex = 0;
      ui.circadianCard.setAttribute('role', 'button');
      ui.circadianCard.addEventListener('click', openCircadianModal);
      ui.circadianCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openCircadianModal();
        }
      });
    }

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
    ui.modalContent = ui.modalRoot?.querySelector('.chart-modal__content') || null;
    ui.modalHeader = ui.modalRoot?.querySelector('.chart-modal__header') || null;
    ui.modalTitle = document.getElementById('chart-modal-title');
    ui.modalSub = document.getElementById('chart-modal-sub');
    ui.modalCanvas = document.getElementById('chart-modal-canvas');
    ui.modalCurrent = document.getElementById('chart-modal-current');
    ui.modalCurrentValue = document.getElementById('chart-modal-current-value');
    ui.modalCurrentUnit = document.getElementById('chart-modal-current-unit');
    ui.modalCurrentLabel = document.getElementById('chart-modal-current-label');
    ui.modalInsight = document.getElementById('chart-modal-insight');
    ui.modalScale = document.getElementById('chart-modal-scale');
    ui.modalScaleSvg = document.getElementById('chart-modal-scale-svg');
    ui.modalScaleCaption = document.getElementById('chart-modal-scale-caption');
    ui.modalState = document.getElementById('chart-modal-state');
    ui.modalStateText = document.getElementById('chart-modal-state-text');
    ui.modalRetry = document.getElementById('chart-modal-retry');
    if (ui.modalRetry) {
      ui.modalRetry.addEventListener('click', retryModalChart);
    }
    ui.modalTabList = document.querySelector('.modal-range-tabs');
    ui.modalTabs = Array.from(document.querySelectorAll('.modal-tab'));
    ui.modalCloseButtons = Array.from(ui.modalRoot?.querySelectorAll('[data-close="true"]') || []);

    ui.modalTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const key = tab.getAttribute('data-range');
        const rangeKey = key in TIME_RANGES ? key : '24h';
        const current = modalConfig.get();
        if (current.rangeKey === rangeKey) return;
        modalConfig.assign({ rangeKey });
        const metric = modalConfig.get().metric;
        if (metric) {
          queueMicrotask(() => {
            loadModalChart(metric, true).catch(handleModalError);
          });
        }
      });
    });
    modalConfig.subscribe(handleModalConfigChange, true);

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

    ui.circadianModal = document.getElementById('circadian-modal');
    ui.circadianModalContent = ui.circadianModal?.querySelector('.circadian-modal__content') || null;
    ui.circadianModalStatus = document.getElementById('circadian-modal-status');
    ui.circadianModalSummary = document.getElementById('circadian-modal-summary');
    ui.circadianModalLuxValue = document.getElementById('circadian-modal-lux-value');
    ui.circadianModalCctValue = document.getElementById('circadian-modal-cct-value');
    ui.circadianLuxCanvas = document.getElementById('circadian-modal-lux-canvas');
    ui.circadianCctCanvas = document.getElementById('circadian-modal-cct-canvas');
    ui.circadianScaleSegments.clear();
    ui.circadianScaleLabels.clear();
    ui.circadianScaleMarkers.clear();

    document.querySelectorAll('.circadian-scale__segments').forEach((element) => {
      const kind = element.getAttribute('data-kind');
      if (kind) {
        ui.circadianScaleSegments.set(kind, element);
      }
    });
    document.querySelectorAll('.circadian-scale__labels').forEach((element) => {
      const kind = element.getAttribute('data-kind');
      if (kind) {
        ui.circadianScaleLabels.set(kind, element);
      }
    });
    ui.circadianScaleValues.clear();
    const scaleLuxValue = document.getElementById('circadian-scale-lux-value');
    if (scaleLuxValue) {
      ui.circadianScaleValues.set('lux', scaleLuxValue);
    }
    const scaleCctValue = document.getElementById('circadian-scale-cct-value');
    if (scaleCctValue) {
      ui.circadianScaleValues.set('cct', scaleCctValue);
    }
    const luxMarker = document.getElementById('circadian-scale-lux-marker');
    if (luxMarker) {
      ui.circadianScaleMarkers.set('lux', luxMarker);
    }
    const cctMarker = document.getElementById('circadian-scale-cct-marker');
    if (cctMarker) {
      ui.circadianScaleMarkers.set('cct', cctMarker);
    }
    ui.circadianModalCloseButtons = Array.from(
      ui.circadianModal?.querySelectorAll('[data-close="true"]') || []
    );
    ui.circadianModalCloseButtons.forEach((button) => {
      button.addEventListener('click', closeCircadianModal);
    });
    if (ui.circadianModal) {
      ui.circadianModal.addEventListener('click', (event) => {
        if (event.target?.dataset?.close === 'true') {
          closeCircadianModal();
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

  function lockBodyScroll() {
    const body = document.body;
    if (!body || state.bodyScrollLock) return;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const lockState = {
      scrollY,
      styles: {
        position: body.style.position || '',
        top: body.style.top || '',
        overflow: body.style.overflow || '',
        width: body.style.width || '',
        left: body.style.left || ''
      }
    };
    state.bodyScrollLock = lockState;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.left = '0';
    body.style.top = `-${scrollY}px`;
    body.classList.add('is-modal-open');
  }

  function unlockBodyScroll() {
    const body = document.body;
    if (!body) return;
    const lockState = state.bodyScrollLock;
    body.classList.remove('is-modal-open');
    if (lockState) {
      const { styles, scrollY } = lockState;
      body.style.position = styles.position || '';
      body.style.top = styles.top || '';
      body.style.overflow = styles.overflow || '';
      body.style.width = styles.width || '';
      body.style.left = styles.left || '';
      state.bodyScrollLock = null;
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY || 0, left: 0 });
      });
    } else {
      body.style.position = '';
      body.style.top = '';
      body.style.overflow = '';
      body.style.width = '';
      body.style.left = '';
    }
  }

  function getModalFocusables() {
    const container = state.activeModalContent;
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.hasAttribute('disabled')) return false;
      if (element.getAttribute('aria-hidden') === 'true') return false;
      if (element.tabIndex === -1) return false;
      return element.offsetParent !== null;
    });
  }

  function handleModalFocusTrap(event) {
    if (event.key !== 'Tab') {
      return;
    }
    const root = state.activeModalRoot;
    const content = state.activeModalContent;
    if (!root || !content || root.hidden) {
      return;
    }
    const focusables = getModalFocusables();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (!active || !content.contains(active) || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (!active || !content.contains(active) || active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function activateModalFocusTrap(root, content) {
    if (!root || !content) return;
    state.activeModalRoot = root;
    state.activeModalContent = content;
    state.activeModalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener('keydown', handleModalFocusTrap, true);
    const focusables = getModalFocusables();
    if (focusables.length > 0) {
      window.requestAnimationFrame(() => {
        focusables[0].focus();
      });
    } else if (content) {
      window.requestAnimationFrame(() => {
        content.focus?.();
      });
    }
  }

  function releaseModalFocusTrap(root) {
    if (root && state.activeModalRoot && root !== state.activeModalRoot) {
      return;
    }
    document.removeEventListener('keydown', handleModalFocusTrap, true);
    const target = state.activeModalReturnFocus;
    state.activeModalRoot = null;
    state.activeModalContent = null;
    state.activeModalReturnFocus = null;
    if (target && typeof target.focus === 'function') {
      window.requestAnimationFrame(() => target.focus());
    }
  }

  function queueModalLayoutSync() {
    if (state.modalLayoutFrame) {
      window.cancelAnimationFrame(state.modalLayoutFrame);
    }
    state.modalLayoutFrame = window.requestAnimationFrame(() => {
      updateModalStickyOffsets();
    });
  }

  function updateModalStickyOffsets() {
    if (!ui.modalTabList || !ui.modalHeader) return;
    const headerHeight = ui.modalHeader.getBoundingClientRect().height || 0;
    const offset = Math.max(Math.round(headerHeight + 12), 72);
    ui.modalTabList.style.setProperty('--tabs-offset', `${offset}px`);
  }

  function scheduleModalResize() {
    if (!state.modalChart) return;
    window.clearTimeout(state.modalResizeTimer);
    state.modalResizeTimer = window.setTimeout(() => {
      if (!state.modalChart) return;
      try {
        state.modalChart.resize();
        scheduleChartUpdate(state.modalChart);
        queueModalLayoutSync();
      } catch (error) {
        console.warn('Chart-Resize fehlgeschlagen', error);
      }
    }, 160);
  }

  function attachModalResizeHandlers() {
    if (!ui.modalCanvas || state.modalResizeActive) return;
    const target = ui.modalCanvas.closest('.chart-modal__canvas');
    if (!target) return;
    state.modalResizeTarget = target;
    if ('ResizeObserver' in window) {
      if (!state.modalResizeObserver) {
        state.modalResizeObserver = new ResizeObserver(() => scheduleModalResize());
      }
      state.modalResizeObserver.observe(target);
    }
    window.addEventListener('resize', scheduleModalResize);
    window.addEventListener('orientationchange', scheduleModalResize);
    state.modalResizeActive = true;
    scheduleModalResize();
  }

  function detachModalResizeHandlers() {
    if (!state.modalResizeActive) return;
    window.removeEventListener('resize', scheduleModalResize);
    window.removeEventListener('orientationchange', scheduleModalResize);
    if (state.modalResizeObserver) {
      try {
        if (state.modalResizeTarget) {
          state.modalResizeObserver.unobserve(state.modalResizeTarget);
        }
        state.modalResizeObserver.disconnect();
      } catch (error) {
        console.warn('ResizeObserver konnte nicht getrennt werden', error);
      }
    }
    state.modalResizeTarget = null;
    state.modalResizeActive = false;
    window.clearTimeout(state.modalResizeTimer);
    state.modalResizeTimer = 0;
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
            borderWidth: 1,
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
    const response = await fetch('/api/now', { headers: { 'Accept': 'application/json' } });
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
    const activeModalMetric = modalConfig.get().metric;
    if (activeModalMetric) {
      refreshModalDetails(activeModalMetric);
    }
    if (displayData['Luftdruck']) {
      refreshPressureTrend().catch((error) => console.warn('Drucktrend Fehler', error));
    }
  }

  function normalizeNowData(raw) {
    const mapped = {};
    const fallbackTs = Date.now();
    for (const [rawKey, value] of Object.entries(raw)) {
      if (value == null) continue;
      if (rawKey == null) continue;
      const normalizedKey = typeof rawKey === 'string' ? rawKey.trim() : rawKey;
      const lowerKey = typeof normalizedKey === 'string' ? normalizedKey.toLowerCase() : normalizedKey;
      const aliasTarget = typeof normalizedKey === 'string'
        ? NOW_KEY_ALIASES.get(normalizedKey) || NOW_KEY_ALIASES.get(lowerKey)
        : null;
      let key = aliasTarget || normalizedKey;
      if (typeof key === 'string') {
        const lowered = key.toLowerCase();
        if (lowered.includes('temperatur') && !lowered.includes('farb')) {
          key = 'Temperatur';
        }
      }
      const sample = normalizeNowSample(value, fallbackTs);
      if (!sample) continue;
      const existing = mapped[key];
      if (!existing || (sample.ts && (!existing.ts || sample.ts >= existing.ts))) {
        mapped[key] = sample;
      }
    }
    return mapped;
  }

  function normalizeNowSample(value, fallbackTs) {
    if (value == null) return null;
    if (typeof value === 'object' && value !== null) {
      const cloned = { ...value };
      if ('value' in cloned) {
        const numeric = parseNumeric(cloned.value);
        if (Number.isFinite(numeric)) {
          cloned.value = numeric;
        } else {
          return null;
        }
      }
      if ('ts' in cloned) {
        const numericTs = parseInt(cloned.ts, 10);
        if (Number.isFinite(numericTs)) {
          cloned.ts = numericTs;
        } else {
          delete cloned.ts;
        }
      }
      if (typeof cloned.value !== 'number' || !Number.isFinite(cloned.value)) {
        return null;
      }
      if (!('ts' in cloned)) {
        cloned.ts = fallbackTs;
      }
      return cloned;
    }
    const numeric = parseNumeric(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return { value: numeric, ts: fallbackTs };
  }

  function parseNumeric(input) {
    if (typeof input === 'number') {
      return Number.isFinite(input) ? input : NaN;
    }
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) {
        return NaN;
      }
      const cleaned = trimmed
        .replace(/\u202f/g, '')
        .replace(/\s/g, '')
        .replace(/[^0-9.,+\-]/g, '');
      if (!cleaned) {
        return NaN;
      }
      let normalized = cleaned;
      if (normalized.includes(',')) {
        normalized = normalized.replace(/\./g, '');
        normalized = normalized.replace(/,/g, '.');
      } else {
        const parts = normalized.split('.');
        if (parts.length > 2) {
          const fraction = parts.pop();
          normalized = `${parts.join('')}.${fraction}`;
        }
      }
      const numeric = Number.parseFloat(normalized);
      return Number.isFinite(numeric) ? numeric : NaN;
    }
    return NaN;
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
    const metrics = HERO_METRICS;
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
          return buildStatus('excellent', 'Luft sehr frisch.', 'Kein Handlungsbedarf.');
        }
        if (value <= 1000) {
          return buildStatus('good', 'CO₂ im stabilen Bereich.', 'Regelmäßiges Lüften hält das Niveau.');
        }
        if (value <= 1400) {
          return buildStatus('elevated', 'CO₂ steigt – Konzentration sinkt.', 'Jetzt querlüften.');
        }
        return buildStatus('poor', 'Sehr hohe CO₂-Belastung.', 'Fenster öffnen oder Lüftung aktivieren.');
      case 'PM1.0':
        if (value <= 5) {
          return buildStatus('excellent', 'Sehr geringe PM1-Belastung.', 'Keine Maßnahmen erforderlich.');
        }
        if (value <= 12) {
          return buildStatus('good', 'PM1 im gesunden Bereich.', 'Leichtes Lüften genügt.');
        }
        if (value <= 35) {
          return buildStatus('elevated', 'Feinstaub steigt an.', 'Innenquellen reduzieren und lüften.');
        }
        return buildStatus('poor', 'Hohe PM1-Konzentration.', 'Intensiv lüften und HEPA-Filter einsetzen.');
      case 'PM2.5':
        if (value <= 5) {
          return buildStatus('excellent', 'PM2.5 kaum messbar.', 'Weiter so.');
        }
        if (value <= 12) {
          return buildStatus('good', 'Feinstaub unauffällig.', 'Kurzes Lüften reicht.');
        }
        if (value <= 25) {
          return buildStatus('elevated', 'Belastung nimmt zu.', 'Luftreiniger prüfen und lüften.');
        }
        return buildStatus('poor', 'Hohe PM2.5-Werte.', 'Sofort lüften oder Filter aktivieren.');
      case 'PM10':
        if (value <= 20) {
          return buildStatus('excellent', 'Kaum aufgewirbelter Staub.', 'Situation beibehalten.');
        }
        if (value <= 40) {
          return buildStatus('good', 'PM10 im grünen Bereich.', 'Regelmäßig lüften genügt.');
        }
        if (value <= 60) {
          return buildStatus('elevated', 'Staubbelastung steigt.', 'Staubquellen reduzieren und lüften.');
        }
        if (value <= 100) {
          return buildStatus('poor', 'Hohe PM10-Werte.', 'Gründlich lüften und Oberflächen reinigen.');
        }
        return buildStatus('poor', 'Extrem hohe PM10-Belastung.', 'Intensiv lüften und Luftreiniger einsetzen.');
      case 'TVOC':
        if (value <= 150) {
          return buildStatus('excellent', 'VOC-Belastung sehr niedrig.', 'Keine Aktion erforderlich.');
        }
        if (value <= 300) {
          return buildStatus('good', 'VOC unauffällig.', 'Regelmäßiges Lüften beibehmen.');
        }
        if (value <= 600) {
          return buildStatus('elevated', 'Flüchtige Stoffe nehmen zu.', 'Quellen prüfen und lüften.');
        }
        return buildStatus('poor', 'Hohe VOC-Belastung.', 'Lüften und Auslöser reduzieren.');
      case 'Temperatur':
        if (value < 19) {
          return buildStatus('poor', 'Deutlich zu kühl.', 'Heizung anpassen oder wärmer kleiden.');
        }
        if (value < 20) {
          return buildStatus('elevated', 'Leicht unter Komfort.', 'Behutsam aufheizen.');
        }
        if (value <= 24) {
          return buildStatus('excellent', 'Im Wohlfühlbereich.', 'Temperatur beibehalten.');
        }
        if (value <= 26) {
          return buildStatus('elevated', 'Etwas warm.', 'Stoßlüften oder Beschattung nutzen.');
        }
        return buildStatus('poor', 'Sehr warm – belastend.', 'Aktiv kühlen und konsequent lüften.');
      case 'rel. Feuchte':
        if (value < 35) {
          return buildStatus('poor', 'Luft sehr trocken.', 'Befeuchten oder Pflanzen aufstellen.');
        }
        if (value < 40) {
          return buildStatus('elevated', 'Leicht trocken.', 'Sanft befeuchten oder lüften.');
        }
        if (value <= 55) {
          return buildStatus('excellent', 'Wohlfühlfeuchte.', 'Aktuelles Verhalten passt.');
        }
        if (value <= 60) {
          return buildStatus('good', 'Etwas feucht.', 'Regelmäßig lüften.');
        }
        if (value <= 70) {
          return buildStatus('elevated', 'Sehr feucht – Schimmelgefahr.', 'Stoßlüften und trocknen.');
        }
        return buildStatus('poor', 'Extrem feucht.', 'Entfeuchter einsetzen und dauerhaft lüften.');
      case 'Lux':
        if (value < 100) {
          return buildStatus('poor', 'Licht deutlich zu schwach.', 'Helligkeit erhöhen oder Tageslicht nutzen.');
        }
        if (value < 500) {
          return buildStatus('elevated', 'Licht knapp für Fokus.', 'Arbeitslicht einschalten oder Vorhänge öffnen.');
        }
        if (value <= 1000) {
          return buildStatus('excellent', 'Beleuchtung im Zielbereich.', 'Lichtsituation beibehalten.');
        }
        if (value <= 1500) {
          return buildStatus('good', 'Kräftiges Licht unterstützt.', 'Blendquellen prüfen.');
        }
        return buildStatus('poor', 'Sehr hell – Blendgefahr.', 'Licht dimmen oder indirekt ausrichten.');
      case 'Farbtemperatur':
        if (value < 3200) {
          return buildStatus('elevated', 'Sehr warmes Licht – beruhigend.', 'Für Fokusphasen etwas kühler wählen.');
        }
        if (value < 5200) {
          return buildStatus('excellent', 'Neutral bis leicht kühl – ideal für Aktivität.', 'Am Abend langsam auf warmes Licht wechseln.');
        }
        if (value <= 6000) {
          return buildStatus('good', 'Kühles Licht aktiviert.', 'Am späten Tag auf wärmere Lichtfarbe umstellen.');
        }
        return buildStatus('poor', 'Sehr kühles Licht – stört abends.', 'Später am Tag warmes Licht verwenden.');
      default:
        return buildStatus('neutral', '', '');
    }
  }

  function buildStatus(intent, note, tip) {
    const tone = intent || 'neutral';
    return {
      intent: tone,
      tone,
      label: STATUS_LABELS[tone] || STATUS_LABELS.neutral,
      note,
      tip
    };
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
      excellent: '#16a34a',
      optimal: '#16a34a',
      good: '#0ea5e9',
      elevated: '#facc15',
      warning: '#facc15',
      poor: '#ef4444',
      critical: '#ef4444',
      neutral: '#94a3b8'
    };
    return palette[tone] || '#0ea5e9';
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
    const cctRangeLabel = `${formatNumber(phase.cctRange[0], 0)}–${formatNumber(phase.cctRange[1], 0)}${NARROW_SPACE}K`;
    const luxRangeLabel = `${formatNumber(phase.luxRange[0], 0)}–${formatNumber(phase.luxRange[1], 0)}${NARROW_SPACE}lx`;
    ui.cctNow.textContent = formatWithUnit(cctValue, 'K', 0);
    ui.cctTarget.textContent = `Ziel ${cctRangeLabel}`;
    ui.cctEval.dataset.tone = evaluation.cctTone;
    ui.cctEval.textContent = evaluation.cctLabel;
    ui.luxNow.textContent = formatWithUnit(luxValue, 'lx', 0);
    ui.luxTarget.textContent = `Ziel ${luxRangeLabel}`;
    ui.luxEval.dataset.tone = evaluation.luxTone;
    ui.luxEval.textContent = evaluation.luxLabel;
    if (ui.barCct) {
      ui.barCct.setAttribute('data-range-label', `Ziel ${cctRangeLabel}`);
    }
    if (ui.barLux) {
      ui.barLux.setAttribute('data-range-label', `Ziel ${luxRangeLabel}`);
    }

    updateBarTrack(ui.barCct, cctValue, phase.cctRange, CCT_RANGE, evaluation.cctTone);
    updateBarTrack(ui.barLux, luxValue, phase.luxRange, LUX_RANGE, evaluation.luxTone);
    updateCircadianCycle(phase);

    ui.circadianCard.dataset.intent = evaluation.cctTone;
    ui.circadianCard.classList.add('ready');

    refreshCircadianModal().catch((error) => {
      console.warn('Circadian Modal Update fehlgeschlagen', error);
    });
  }

  function updateCircadianCycle(phase) {
    if (!ui.circadianCycle) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const percent = (minutes / (24 * 60)) * 100;
    const bounded = clamp(percent, 3, 97);
    ui.circadianCycle.style.setProperty('--cycle-pos', `${bounded}%`);
    if (ui.circadianCycleLabel) {
      ui.circadianCycleLabel.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (ui.circadianCycleMarker) {
      ui.circadianCycleMarker.style.setProperty('--pos', `${bounded}%`);
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
      actionText = 'CCT-Sensor prüfen';
    } else if (cct < cctMin) {
      cctLabel = 'zu warm';
      cctTone = 'elevated';
      cctStatus = 'CCT unter Ziel';
      actionText = 'Licht kühler einstellen';
    } else if (cct > cctMax) {
      cctLabel = 'zu kalt';
      cctTone = 'poor';
      cctStatus = 'CCT über Ziel';
      actionText = 'Licht wärmer stellen';
    } else {
      cctLabel = 'im Ziel';
      cctTone = 'excellent';
      cctStatus = 'CCT im Ziel';
      actionText = 'Licht passt';
    }

    let luxLabel;
    let luxTone;
    let luxAction;
    if (lux == null) {
      luxLabel = 'keine Daten';
      luxTone = 'neutral';
      luxAction = 'Lux-Sensor prüfen';
    } else if (lux < luxMin) {
      luxLabel = 'zu dunkel';
      luxTone = 'elevated';
      luxAction = 'Helligkeit erhöhen';
    } else if (lux > luxMax) {
      luxLabel = 'zu hell';
      luxTone = 'poor';
      luxAction = 'Licht dimmen';
    } else {
      luxLabel = 'im Ziel';
      luxTone = 'excellent';
      luxAction = 'Helligkeit passt';
    }

    const luxText = lux != null
      ? `Lux ${formatNumber(lux, 0)}${NARROW_SPACE}lx → Ziel ${formatNumber(luxMin, 0)}–${formatNumber(luxMax, 0)}${NARROW_SPACE}lx`
      : '';
    const tipParts = [phase.context, actionText];
    if (luxAction && luxAction !== 'Helligkeit passt') {
      tipParts.push(luxAction);
    }
    if (luxText) {
      tipParts.push(luxText);
    }
    const tip = tipParts.filter(Boolean).join(' • ');

    return {
      cctStatus,
      cctLabel,
      cctTone,
      luxLabel,
      luxTone,
      tip
    };
  }

  function openCircadianModal() {
    if (!ui.circadianModal) return;
    if (!state.bodyScrollLock) {
      lockBodyScroll();
    }
    ui.circadianModal.hidden = false;
    activateModalFocusTrap(ui.circadianModal, ui.circadianModalContent);
    refreshCircadianModal(true).catch(handleError);
  }

  function closeCircadianModal() {
    if (!ui.circadianModal || ui.circadianModal.hidden) return;
    ui.circadianModal.hidden = true;
    releaseModalFocusTrap(ui.circadianModal);
    if (!ui.modalRoot || ui.modalRoot.hidden) {
      unlockBodyScroll();
    }
  }

  async function refreshCircadianModal(forceCharts = false) {
    if (!ui.circadianModal) return;
    const phase = resolveCircadianPhase();
    const luxValue = state.now?.Lux?.value;
    const cctValue = state.now?.Farbtemperatur?.value;

    updateCircadianModalSummary(phase, luxValue, cctValue);
    updateCircadianModalScales(phase, luxValue, cctValue);

    const chartsVisible = !ui.circadianModal.hidden || forceCharts;
    if (!chartsVisible) {
      return;
    }

    const range = TIME_RANGES['24h'];
    const [luxSeries, cctSeries] = await Promise.all([
      ensureSeries(CHART_DEFINITIONS.Lux, range, forceCharts),
      ensureSeries(CHART_DEFINITIONS.Farbtemperatur, range, forceCharts)
    ]);

    updateCircadianModalChart('lux', luxSeries?.Lux || [], phase.luxRange);
    updateCircadianModalChart('cct', cctSeries?.Farbtemperatur || [], phase.cctRange);
  }

  function updateCircadianModalSummary(phase, luxValue, cctValue) {
    if (ui.circadianModalSummary) {
      const luxRange = formatRangeLabel(phase.luxRange, 'lx');
      const cctRange = formatRangeLabel(phase.cctRange, 'K');
      ui.circadianModalSummary.textContent = `Empfohlene Lichtumgebung für ${phase.window}: ${luxRange} und ${cctRange}`;
    }

    const badge = computeCircadianBadge(phase, luxValue, cctValue);
    if (ui.circadianModalStatus) {
      ui.circadianModalStatus.textContent = badge.text;
      ui.circadianModalStatus.dataset.tone = badge.tone;
    }

    if (ui.circadianModalLuxValue) {
      ui.circadianModalLuxValue.textContent = formatWithUnit(luxValue, 'lx', 0);
    }
    if (ui.circadianModalCctValue) {
      ui.circadianModalCctValue.textContent = formatWithUnit(cctValue, 'K', 0);
    }
  }

  function updateCircadianModalScales(phase, luxValue, cctValue) {
    renderCircadianScale('lux', luxValue);
    renderCircadianScale('cct', cctValue);
  }

  function updateCircadianModalChart(kind, data, targetRange) {
    const definition = kind === 'lux' ? CHART_DEFINITIONS.Lux : CHART_DEFINITIONS.Farbtemperatur;
    const metricKey = definition.metrics[0];
    const chart = ensureCircadianChart(kind, definition, metricKey);
    if (!chart) return;
    chart.data.datasets[0].data = data;
    const unit = METRIC_CONFIG[metricKey]?.unit || '';
    const hasRange = Array.isArray(targetRange) && targetRange.length >= 2;
    chart.options.plugins.targetGuides = chart.options.plugins.targetGuides || {};
    chart.options.plugins.targetGuides.guides = hasRange
      ? [
          {
            min: targetRange[0],
            max: targetRange[1],
            color: STATUS_TONES.good,
            label: `Ziel ${formatRangeLabel(targetRange, unit)}`
          }
        ]
      : [];
    chart.options.plugins.tooltip = chart.options.plugins.tooltip || {};
    chart.options.plugins.tooltip.enabled = Array.isArray(data) && data.length > 0;
    scheduleChartUpdate(chart, 'none');
  }

  function ensureCircadianChart(kind, definition, metricKey) {
    if (state.circadianCharts[kind]) {
      return state.circadianCharts[kind];
    }
    const canvas = kind === 'lux' ? ui.circadianLuxCanvas : ui.circadianCctCanvas;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const color = definition.colors?.[0] || '#0ea5e9';
    const limits = CIRCADIAN_SCALE_LIMITS[kind];
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: METRIC_CONFIG[metricKey]?.label || metricKey,
            data: [],
            borderColor: color,
            backgroundColor: colorWithAlpha(color, 0.2),
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 0,
            fill: 'origin',
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
          tooltip: {
            enabled: false,
            displayColors: false,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            padding: 8,
            callbacks: {
              label(context) {
                const cfg = METRIC_CONFIG[metricKey];
                return formatWithUnit(context.parsed.y, cfg?.unit || '', cfg?.decimals ?? 0);
              }
            }
          },
          targetGuides: { guides: [] }
        },
        scales: {
          x: {
            type: 'time',
            display: false
          },
          y: {
            display: false,
            suggestedMin: limits?.min ?? definition.yBounds?.min,
            suggestedMax: limits?.max ?? definition.yBounds?.max
          }
        }
      }
    });
    state.circadianCharts[kind] = chart;
    return chart;
  }

  function renderCircadianScale(kind, value) {
    const bands = CIRCADIAN_SCALE_BANDS[kind] || [];
    const limits = CIRCADIAN_SCALE_LIMITS[kind];
    const scale = { min: limits.min, max: limits.max, unit: kind === 'lux' ? 'lx' : 'K' };
    const segmentsEl = ui.circadianScaleSegments.get(kind);
    const labelsEl = ui.circadianScaleLabels.get(kind);
    const markerEl = ui.circadianScaleMarkers.get(kind);
    const currentEl = ui.circadianScaleValues.get(kind);
    if (currentEl) {
      currentEl.textContent = formatWithUnit(value, scale.unit, 0);
    }
    if (segmentsEl) {
      segmentsEl.textContent = '';
      bands.forEach((band) => {
        const start = computeScalePosition(band.min ?? scale.min, scale);
        const end = computeScalePosition(band.max ?? scale.max, scale);
        const color = colorWithAlpha(SCALE_TONES[band.tone] || '#0ea5e9', 0.28);
        const segment = document.createElement('span');
        segment.className = 'circadian-scale__segment';
        segment.style.setProperty('--start', `${start}%`);
        segment.style.setProperty('--end', `${end}%`);
        segment.style.setProperty('--segment-color', color);
        segmentsEl.appendChild(segment);
      });
    }
    if (labelsEl) {
      if (bands.length) {
        labelsEl.style.setProperty('--segment-template', buildSegmentTemplate(bands, scale));
        labelsEl.innerHTML = bands
          .map((band) => {
            const display = buildBandDisplay(band, scale.unit);
            return `<span>${band.label}${display ? `<small>${display}</small>` : ''}</span>`;
          })
          .join('');
      } else {
        labelsEl.style.removeProperty('--segment-template');
        labelsEl.innerHTML = '';
      }
    }
    if (markerEl) {
      const percent = computeMarkerPosition(value, scale);
      markerEl.style.setProperty('--pos', `${percent}%`);
      const toneStops = bands.map((band) => ({ value: band.max, tone: band.tone }));
      markerEl.dataset.tone = value == null ? 'neutral' : resolveScaleTone(value, toneStops);
      const labelEl = markerEl.querySelector('.circadian-scale__marker-label');
      if (labelEl) {
        labelEl.textContent = formatWithUnit(value, scale.unit, 0);
      }
      clampMarkerToTrack(markerEl, markerEl.parentElement, percent, '--offset');
    }
  }

  function computeCircadianBadge(phase, luxValue, cctValue) {
    const luxAssessment = assessCircadianDimension(luxValue, phase.luxRange, 'Zu dunkel', 'Zu hell');
    const cctAssessment = assessCircadianDimension(cctValue, phase.cctRange, 'Zu warm', 'Zu kühl');
    const assessments = [luxAssessment, cctAssessment].filter(Boolean);
    if (assessments.length === 0) {
      return { text: 'Neutral', tone: 'neutral', weight: 0 };
    }
    let winner = { text: 'Im Ziel', tone: 'excellent', weight: 0 };
    assessments.forEach((assessment) => {
      if (assessment.weight > winner.weight) {
        winner = assessment;
      }
    });
    if (winner.weight === 0) {
      return { text: 'Im Ziel', tone: 'excellent', weight: 0 };
    }
    return winner;
  }

  function assessCircadianDimension(value, range, belowLabel, aboveLabel) {
    if (!Array.isArray(range) || range.length < 2 || !Number.isFinite(value)) {
      return null;
    }
    if (value < range[0]) {
      return { text: belowLabel, tone: 'elevated', weight: 1 };
    }
    if (value > range[1]) {
      return { text: aboveLabel, tone: 'poor', weight: 2 };
    }
    return { text: 'Im Ziel', tone: 'excellent', weight: 0 };
  }

  function buildSegmentTemplate(bands, scale) {
    const span = Math.max((scale.max ?? scale.min) - (scale.min ?? 0), 1);
    return bands
      .map((band) => {
        const start = Number.isFinite(band.min) ? band.min : scale.min;
        const end = Number.isFinite(band.max) ? band.max : scale.max;
        const width = clamp(((end - start) / span) * 100, 6, 100);
        return `${width.toFixed(2)}%`;
      })
      .join(' ');
  }

  function buildBandDisplay(band, unit) {
    if (band.display) return band.display;
    const hasMin = Number.isFinite(band.min);
    const hasMax = Number.isFinite(band.max);
    if (hasMin && hasMax) {
      return `${formatNumber(band.min, 0)}–${formatNumber(band.max, 0)}${NARROW_SPACE}${unit}`;
    }
    if (hasMin) {
      return `≥ ${formatNumber(band.min, 0)}${NARROW_SPACE}${unit}`;
    }
    if (hasMax) {
      return `≤ ${formatNumber(band.max, 0)}${NARROW_SPACE}${unit}`;
    }
    return '';
  }

  function buildBandTicks(bands, scale) {
    const values = new Set();
    if (Number.isFinite(scale.min)) values.add(scale.min);
    if (Number.isFinite(scale.max)) values.add(scale.max);
    bands.forEach((band) => {
      if (Number.isFinite(band.min)) values.add(band.min);
      if (Number.isFinite(band.max)) values.add(band.max);
    });
    return Array.from(values).sort((a, b) => a - b);
  }

  function computeScalePosition(value, scale) {
    const min = Number.isFinite(scale.min) ? scale.min : 0;
    const max = Number.isFinite(scale.max) ? scale.max : min + 1;
    const span = max - min;
    if (!Number.isFinite(value) || span <= 0) {
      return 0;
    }
    const ratio = (value - min) / span;
    return clamp(ratio * 100, 0, 100);
  }

  function computeMarkerPosition(value, scale) {
    const fallback = Number.isFinite(scale.min)
      ? scale.min
      : Number.isFinite(scale.max)
        ? scale.max
        : 0;
    const numeric = Number.isFinite(value) ? value : fallback;
    return clamp(computeScalePosition(numeric, scale), 4, 96);
  }

  function clampMarkerToTrack(marker, track, percent, offsetVar = '--marker-offset') {
    if (!marker || !track) return;
    window.requestAnimationFrame(() => {
      marker.style.setProperty(offsetVar, '0px');
      const markerRect = marker.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      if (!markerRect.width || !trackRect.width) {
        return;
      }
      const minPadding = 4;
      const center = (percent / 100) * trackRect.width;
      const half = markerRect.width / 2;
      const leftEdge = center - half;
      const rightEdge = center + half;
      let offset = 0;
      if (leftEdge < minPadding) {
        offset = minPadding - leftEdge;
      } else if (rightEdge > trackRect.width - minPadding) {
        offset = (trackRect.width - minPadding) - rightEdge;
      }
      marker.style.setProperty(offsetVar, `${offset}px`);
    });
  }

  function resolveScaleTone(value, stops) {
    if (!Number.isFinite(value) || !Array.isArray(stops) || stops.length === 0) {
      return 'neutral';
    }
    for (const stop of stops) {
      if (!Number.isFinite(stop.value)) continue;
      if (value <= stop.value) {
        return stop.tone || 'neutral';
      }
    }
    const last = stops[stops.length - 1];
    return last?.tone || 'neutral';
  }

  function formatRangeLabel(range, unit) {
    if (!Array.isArray(range) || range.length < 2) {
      return `—${unit ? `${NARROW_SPACE}${unit}` : ''}`;
    }
    const [min, max] = range;
    return `${formatNumber(min, 0)}–${formatNumber(max, 0)}${unit ? `${NARROW_SPACE}${unit}` : ''}`;
  }

  function updateBarTrack(track, value, targetRange, bounds, tone) {
    if (!track) return;
    const scale = { min: bounds.min, max: bounds.max };
    const span = scale.max - scale.min || 1;
    const startPercent = ((targetRange[0] - scale.min) / span) * 100;
    const endPercent = ((targetRange[1] - scale.min) / span) * 100;
    track.style.setProperty('--target-start', `${clamp(startPercent, 0, 100)}%`);
    track.style.setProperty('--target-end', `${clamp(endPercent, 0, 100)}%`);
    if (value == null || !isFinite(value)) {
      track.dataset.state = 'hidden';
      track.style.setProperty('--marker-pos', '-999%');
    } else {
      const markerPercent = computeMarkerPosition(value, scale);
      track.style.setProperty('--marker-pos', `${markerPercent}%`);
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
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '—';
    }
    const formatted = numeric.toLocaleString('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return formatted.replace(/\./g, NARROW_SPACE);
  }

  function formatWithUnit(value, unit, decimals) {
    const number = formatNumber(value, decimals);
    if (number === '—') {
      return `—${unit ? `${NARROW_SPACE}${unit}` : ''}`;
    }
    return unit ? `${number}${NARROW_SPACE}${unit}` : number;
  }

  function delay(ms, signal) {
    if (!Number.isFinite(ms) || ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const cleanup = () => {
        window.clearTimeout(timer);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  function durationToSeconds(literal, fallbackSeconds = NaN) {
    if (typeof literal === 'number') {
      return Number.isFinite(literal) ? literal : fallbackSeconds;
    }
    if (typeof literal !== 'string') {
      return fallbackSeconds;
    }
    const trimmed = literal.trim();
    if (!trimmed) return fallbackSeconds;
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)([smhd])$/i);
    if (!match) {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : fallbackSeconds;
    }
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) {
      return fallbackSeconds;
    }
    const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return value * factor;
  }

  function secondsToDuration(seconds, fallbackLiteral = '60s') {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return fallbackLiteral;
    }
    if (seconds % 86400 === 0) {
      return `${Math.round(seconds / 86400)}d`;
    }
    if (seconds % 3600 === 0) {
      return `${Math.round(seconds / 3600)}h`;
    }
    if (seconds % 60 === 0) {
      return `${Math.round(seconds / 60)}m`;
    }
    return `${Math.round(seconds)}s`;
  }

  function resolveRangeParams(range) {
    const base = typeof range === 'object' && range ? range : {};
    const rangeLiteral = String(base.range || '24h');
    const stepLiteral = String(base.step || '120s');
    const winLiteral = String(base.win || stepLiteral);
    let stepSeconds = durationToSeconds(stepLiteral, 120);
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      stepSeconds = 120;
    }
    let windowSeconds = durationToSeconds(winLiteral, stepSeconds * 2);
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      windowSeconds = stepSeconds * 2;
    }
    const rule = RANGE_RULES[rangeLiteral];
    if (rule) {
      const minStep = Number.isFinite(rule.stepMin) ? rule.stepMin : stepSeconds;
      const maxStep = Number.isFinite(rule.stepMax) ? rule.stepMax : stepSeconds;
      stepSeconds = clamp(stepSeconds, minStep, maxStep);
      const ruleWindowMin = Number.isFinite(rule.windowMin) ? rule.windowMin : stepSeconds * 2;
      if (windowSeconds < ruleWindowMin) {
        windowSeconds = ruleWindowMin;
      }
    }
    if (windowSeconds < stepSeconds * 2) {
      windowSeconds = stepSeconds * 2;
    }
    return {
      range: rangeLiteral,
      step: secondsToDuration(stepSeconds, stepLiteral),
      win: secondsToDuration(windowSeconds, winLiteral)
    };
  }

  async function fetchWithRetry(url, init = {}, context = {}) {
    const { signal, label } = context;
    const attempts = FETCH_RETRY_DELAYS.length + 1;
    for (let index = 0; index < attempts; index++) {
      if (signal?.aborted) {
        logFetchDebug(label || url, 'aborted before request');
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        logFetchDebug(label || url, 'request', index + 1, '/', attempts);
        const response = await fetch(url, { ...init, signal });
        logFetchDebug(label || url, 'response', response.status);
        return response;
      } catch (error) {
        if (error?.name === 'AbortError') {
          logFetchDebug(label || url, 'abort signal');
          throw error;
        }
        const isLast = index >= attempts - 1;
        if (isLast) {
          logFetchDebug(label || url, 'network failed', error);
          throw error;
        }
        const delayMs = FETCH_RETRY_DELAYS[index];
        logFetchDebug(label || url, 'retry in', delayMs, 'ms');
        await delay(delayMs, signal);
      }
    }
    throw new Error('Unreachable');
  }

  async function preloadSeries(force) {
    const definitions = Object.values(CHART_DEFINITIONS).filter((definition) => !definition.optional);
    const baseRange = TIME_RANGES[SPARKLINE_RANGE_KEY] || TIME_RANGES['24h'];
    state.range = baseRange;
    await Promise.all(definitions.map((definition) => ensureSeries(definition, baseRange, force)));
    updateSparklines();
    if (state.now) {
      updateStatusCards(state.now);
    }
  }

  async function ensureSeries(definition, range, force, options = {}) {
    const normalizedRange = { ...range, ...resolveRangeParams(range) };
    const cacheKey = `${definition.key}_${normalizedRange.range}`;
    if (!force && state.chartDataCache.has(cacheKey)) {
      return state.chartDataCache.get(cacheKey);
    }
    const series = await fetchSeries(definition.metrics, normalizedRange, options);
    const smoothed = smoothSeries(series);
    state.chartDataCache.set(cacheKey, smoothed);
    return smoothed;
  }

  async function fetchSeries(metrics, range = state.range, options = {}) {
    const normalizedRange = { ...range, ...resolveRangeParams(range) };
    const entries = await Promise.all(
      metrics.map(async (metric) => {
        const series = await fetchSeriesForMetric(metric, normalizedRange, options);
        return [metric, series];
      })
    );
    return Object.fromEntries(entries);
  }

  async function fetchSeriesForMetric(metric, range, options = {}) {
    const candidates = resolveSeriesNames(metric);
    let lastError = null;
    for (const name of candidates) {
      try {
        return await requestSeries(metric, name, range, options);
      } catch (error) {
        if (error?.code === 'unknown_metric') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    throw buildSeriesError(metric, range, null);
  }

  function resolveSeriesNames(metric) {
    const list = SERIES_NAME_ALIASES.get(metric);
    if (!Array.isArray(list) || !list.length) {
      return [metric];
    }
    return Array.from(new Set([metric, ...list]));
  }

  async function requestSeries(metric, queryName, range, options = {}) {
    const params = new URLSearchParams({
      name: queryName,
      range: range.range,
      step: range.step,
      win: range.win
    });
    const maxAttempts = EMPTY_SERIES_RETRY_DELAYS.length + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      let response;
      try {
        response = await fetchWithRetry(`/api/series?${params.toString()}`, {
          headers: { Accept: 'application/json' }
        }, { signal: options.signal, label: `${metric}:${queryName}:${range.range}#${attempt + 1}` });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        const err = buildNetworkError(metric, range, error);
        err.code = 'network_error';
        err.cause = error;
        throw err;
      }
      let payload = null;
      try {
        payload = await response.clone().json();
      } catch (error) {
        payload = null;
      }
      if (!response.ok) {
        const err = buildSeriesError(metric, range, payload);
        if (payload?.error === 'unknown_metric') {
          err.code = 'unknown_metric';
        }
        throw err;
      }
      if (!payload || !payload.ok) {
        const err = buildSeriesError(metric, range, payload);
        if (payload?.error === 'unknown_metric') {
          err.code = 'unknown_metric';
        }
        throw err;
      }
      const values = normalizeSeriesValues(payload.data);
      const rawPoints = values
        .map((row) => {
          const ts = Number(row[0]);
          const val = Number(row[1]);
          if (!Number.isFinite(ts) || !Number.isFinite(val)) {
            return null;
          }
          return { x: ts * 1000, y: val };
        })
        .filter(Boolean);
      const cleaned = dedupePoints(rawPoints);
      const limited = limitPoints(cleaned);
      if (limited.length === 0 && attempt < EMPTY_SERIES_RETRY_DELAYS.length) {
        const delayMs = EMPTY_SERIES_RETRY_DELAYS[attempt];
        try {
          await delay(delayMs, options.signal);
        } catch (error) {
          if (error?.name === 'AbortError') {
            throw error;
          }
          throw error;
        }
        continue;
      }
      return limited;
    }
    return [];
  }

  function buildSeriesError(metric, range, payload) {
    const label = METRIC_CONFIG[metric]?.label || metric;
    const rangeLabel = typeof range?.label === 'string'
      ? range.label
      : typeof range?.range === 'string'
        ? range.range
        : '24 h';
    if (payload?.error === 'unknown_metric' && Array.isArray(payload?.known)) {
      console.warn(`Unbekannte Serie angefordert: ${metric}`, payload.known);
    } else if (payload?.error) {
      console.warn(`Serie ${metric} antwortete mit Fehler:`, payload.error);
    }
    return new Error(`Die Daten für ${label} konnten nicht geladen werden (${rangeLabel}). Bitte später erneut versuchen.`);
  }

  function buildNetworkError(metric, range, originalError) {
    const label = METRIC_CONFIG[metric]?.label || metric;
    const rangeLabel = typeof range?.label === 'string'
      ? range.label
      : typeof range?.range === 'string'
        ? range.range
        : '24 h';
    const message = `Netzwerkfehler: ${label} (${rangeLabel}) konnte nicht geladen werden. Bitte Verbindung prüfen und erneut versuchen.`;
    if (originalError) {
      console.warn('Netzwerkfehler beim Laden der Serien', originalError);
    }
    return new Error(message);
  }

  function updateSparklines() {
    HERO_METRICS.forEach((metric) => {
      const sparkline = state.sparklines.get(metric);
      if (!sparkline) return;
      const definition = getDefinitionForMetric(metric);
      if (!definition) return;
      const cacheKey = `${definition.key}_${SPARKLINE_RANGE_KEY}`;
      const cached = state.chartDataCache.get(cacheKey);
      if (!cached) return;
      const data = prepareSparklineData(cached[metric] || []);
      sparkline.data.datasets[0].data = data;
      const card = ui.heroCards.get(metric);
      const sample = state.now?.[metric];
      const status = sample && isFinite(sample.value) ? determineStatus(metric, sample.value) : null;
      const tone = status?.tone || status?.intent || 'neutral';
      const color = toneToColor(tone) || definition.colors?.[0] || '#0ea5e9';
      sparkline.data.datasets[0].borderColor = color;
      sparkline.data.datasets[0].backgroundColor = colorWithAlpha(color, 0.18);
      scheduleChartUpdate(sparkline, 'none');
      if (card) {
        const container = card.querySelector('.mini-chart');
        if (container) {
          container.classList.toggle('is-empty', data.length < 2);
        }
      }
    });
  }

  function prepareSparklineData(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return [];
    }
    if (points.length <= 3) {
      return clonePoints(points);
    }
    const windowSize = points.length > 180 ? 5 : points.length > 90 ? 4 : 3;
    const averaged = movingAverage(points, windowSize);
    return clonePoints(averaged);
  }

  function updateModalTabs(activeKey = modalConfig.get().rangeKey) {
    const key = activeKey in TIME_RANGES ? activeKey : '24h';
    ui.modalTabs.forEach((tab) => {
      tab.setAttribute('aria-selected', tab.getAttribute('data-range') === key ? 'true' : 'false');
    });
    queueModalLayoutSync();
  }

  function handleModalConfigChange(snapshot) {
    updateModalTabs(snapshot.rangeKey);
    renderModalState(snapshot);
  }

  function refreshModalDetails(metric) {
    updateModalCurrent(metric);
    updateModalScale(metric);
  }

  function renderModalState(snapshot = modalConfig.get()) {
    if (!ui.modalState) return;
    const loading = Boolean(snapshot.loading);
    const error = snapshot.error;
    const empty = Boolean(snapshot.empty) && !error && !loading;
    const shouldShow = loading || Boolean(error) || empty;
    ui.modalState.hidden = !shouldShow;
    ui.modalState.classList.toggle('is-loading', loading);
    ui.modalState.classList.toggle('is-error', Boolean(error));
    ui.modalState.classList.toggle('is-empty', empty);
    const canvasContainer = ui.modalCanvas?.closest('.chart-modal__canvas');
    if (canvasContainer) {
      canvasContainer.classList.toggle('is-loading', loading);
      canvasContainer.classList.toggle('is-empty', empty);
    }
    if (ui.modalStateText) {
      let text = '';
      if (loading) {
        text = 'Diagramm wird geladen …';
      } else if (error) {
        text = error;
      } else if (empty) {
        text = 'Keine Daten für dieses Zeitfenster verfügbar.';
      }
      ui.modalStateText.textContent = text;
    }
    if (ui.modalRetry) {
      ui.modalRetry.hidden = !(error || empty);
    }
    if (ui.modalCanvas) {
      if (loading) {
        ui.modalCanvas.setAttribute('aria-busy', 'true');
      } else {
        ui.modalCanvas.removeAttribute('aria-busy');
      }
    }
    queueModalLayoutSync();
  }

  function updateModalInsight(metric) {
    if (!ui.modalInsight) return;
    const insight = METRIC_INSIGHTS[metric];
    if (!insight?.sections?.length) {
      ui.modalInsight.innerHTML =
        '<div><dt>Hinweis</dt><dd>Für diese Messgröße liegen derzeit keine Zusatzinformationen vor.</dd></div>';
      return;
    }
    let html = insight.sections
      .map((section) => `<div><dt>${section.title}</dt><dd>${section.text}</dd></div>`)
      .join('');
    if (metric === 'Lux' || metric === 'Farbtemperatur') {
      const phase = resolveCircadianPhase();
      const cctValue = state.now?.Farbtemperatur?.value;
      const luxValue = state.now?.Lux?.value;
      const evaluation = evaluateCircadian(cctValue, luxValue, phase);
      const isLux = metric === 'Lux';
      const unit = isLux ? 'lx' : 'K';
      const currentValue = isLux ? luxValue : cctValue;
      const range = isLux ? phase.luxRange : phase.cctRange;
      const statusLabel = isLux ? evaluation.luxLabel : evaluation.cctLabel;
      const tone = isLux ? evaluation.luxTone : evaluation.cctTone;
      const valueText = currentValue != null
        ? formatWithUnit(currentValue, unit, 0)
        : `—${NARROW_SPACE}${unit}`;
      const rangeText = `${formatNumber(range[0], 0)}–${formatNumber(range[1], 0)}${NARROW_SPACE}${unit}`;
      html += `<div data-tone="${tone || 'neutral'}"><dt>Aktuelle Phase</dt><dd>${phase.title}: ${statusLabel} (${valueText}) • Ziel ${rangeText}. ${evaluation.tip}</dd></div>`;
    }
    ui.modalInsight.innerHTML = html;
    queueModalLayoutSync();
  }

  function updateModalCurrent(metric) {
    if (!ui.modalCurrent || !ui.modalCurrentValue || !ui.modalCurrentUnit || !ui.modalCurrentLabel) return;
    const config = METRIC_CONFIG[metric];
    if (!config) {
      ui.modalCurrent.dataset.tone = 'neutral';
      applyModalTone('neutral');
      ui.modalCurrentValue.textContent = '—';
      ui.modalCurrentUnit.textContent = '';
      ui.modalCurrentLabel.textContent = 'Unbekannt';
      queueModalLayoutSync();
      return;
    }
    const sample = state.now?.[metric];
    const unit = config.unit || '';
    ui.modalCurrentUnit.textContent = unit;
    if (!sample || !isFinite(sample.value)) {
      ui.modalCurrent.dataset.tone = 'neutral';
      applyModalTone('neutral');
      ui.modalCurrentValue.textContent = '—';
      ui.modalCurrentLabel.textContent = 'Keine Daten';
      queueModalLayoutSync();
      return;
    }
    const status = determineStatus(metric, sample.value);
    ui.modalCurrentValue.textContent = formatNumber(sample.value, config.decimals);
    ui.modalCurrentLabel.textContent = status.label || 'Aktuell';
    ui.modalCurrent.dataset.tone = status.tone || status.intent || 'neutral';
    applyModalTone(status.tone || status.intent || 'neutral');
    queueModalLayoutSync();
  }

  function applyModalTone(tone) {
    const resolved = tone || 'neutral';
    if (ui.modalRoot) {
      ui.modalRoot.dataset.tone = resolved;
    }
    if (ui.modalHeader) {
      ui.modalHeader.dataset.tone = resolved;
    }
    if (ui.modalTabList) {
      const color = STATUS_TONES[resolved] || STATUS_TONES.neutral;
      ui.modalTabList.style.setProperty('--tab-tone-color', color);
      ui.modalTabList.style.setProperty('--tab-tone-bg', colorWithAlpha(color, 0.18));
    }
  }

  function updateModalScale(metric) {
    if (!ui.modalScale || !ui.modalScaleSvg) return;
    const normalized = normalizeScaleConfig(metric);
    if (!normalized) {
      ui.modalScale.hidden = true;
      if (ui.modalScaleCaption) {
        ui.modalScaleCaption.textContent = '';
      }
      queueModalLayoutSync();
      return;
    }
    ui.modalScale.hidden = false;
    const sample = state.now?.[metric];
    const config = METRIC_CONFIG[metric];
    const value = sample && isFinite(sample.value) ? sample.value : null;
    const decimals = config?.decimals ?? 0;
    let caption = normalized.caption || '';
    let highlight = null;
    if (metric === 'Lux' || metric === 'Farbtemperatur') {
      const phase = resolveCircadianPhase();
      const range = metric === 'Lux' ? phase.luxRange : phase.cctRange;
      if (Array.isArray(range) && range.length >= 2) {
        highlight = { from: range[0], to: range[1] };
        const formattedRange = `${formatNumber(range[0], 0)}–${formatNumber(range[1], 0)}${NARROW_SPACE}${normalized.unit}`;
        caption = `${phase.title}: Ziel ${formattedRange}`;
      }
    }
    renderScaleGraphic(ui.modalScaleSvg, normalized, value, {
      unit: normalized.unit,
      decimals,
      highlight
    });
    if (ui.modalScaleCaption) {
      ui.modalScaleCaption.textContent = caption;
    }
    queueModalLayoutSync();
  }

  function normalizeScaleConfig(metric) {
    const preset = VALUE_SCALE_PRESETS[metric];
    const base = METRIC_INSIGHTS[metric]?.scale || {};
    const unit = preset?.unit || base.unit || '';
    const minCandidate = Number.isFinite(preset?.min) ? preset.min : Number(base.min);
    const maxCandidate = Number.isFinite(preset?.max) ? preset.max : Number(base.max);
    const min = Number.isFinite(minCandidate) ? minCandidate : 0;
    const max = Number.isFinite(maxCandidate) && maxCandidate > min ? maxCandidate : min + 1;
    const caption = preset?.caption || base.caption || '';
    const segments = preset?.segments
      ? preset.segments.map((segment) => ({ ...segment }))
      : buildSegmentsFromScale(base, min, max);
    const ticks = preset?.ticks
      ? preset.ticks.map((tick) => ({ ...tick }))
      : buildTicksFromScale(base, min, max);
    return { unit, min, max, caption, segments, ticks };
  }

  function buildSegmentsFromScale(scale, min, max) {
    if (Array.isArray(scale?.bands) && scale.bands.length) {
      return scale.bands.map((band) => ({
        from: Number.isFinite(band.min) ? band.min : min,
        to: Number.isFinite(band.max) ? band.max : max,
        label: band.label,
        detail: band.display || null,
        tone: band.tone || 'neutral'
      }));
    }
    if (Array.isArray(scale?.stops) && scale.stops.length) {
      const sorted = scale.stops
        .filter((stop) => Number.isFinite(stop.value))
        .map((stop) => ({ ...stop }))
        .sort((a, b) => a.value - b.value);
      const segments = [];
      let start = min;
      sorted.forEach((stop) => {
        if (stop.value > start) {
          segments.push({ from: start, to: stop.value, label: stop.label, tone: stop.tone || 'neutral' });
          start = stop.value;
        }
      });
      if (start < max) {
        const last = sorted[sorted.length - 1];
        segments.push({ from: start, to: max, label: last?.label, tone: last?.tone || 'neutral' });
      }
      if (!segments.length) {
        segments.push({ from: min, to: max, label: '', tone: 'neutral' });
      }
      return segments;
    }
    return [{ from: min, to: max, label: '', tone: 'neutral' }];
  }

  function buildTicksFromScale(scale, min, max) {
    const values = new Set();
    values.add(min);
    if (Array.isArray(scale?.bands)) {
      scale.bands.forEach((band) => {
        if (Number.isFinite(band.min)) values.add(band.min);
        if (Number.isFinite(band.max)) values.add(band.max);
      });
    }
    if (Array.isArray(scale?.stops)) {
      scale.stops.forEach((stop) => {
        if (Number.isFinite(stop.value)) values.add(stop.value);
      });
    }
    values.add(max);
    return Array.from(values)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((at) => ({ at }));
  }

  function renderScaleGraphic(svg, config, value, options = {}) {
    if (!svg) return;
    const unit = options.unit || config.unit || '';
    const decimals = options.decimals ?? 0;
    const highlight = options.highlight;
    const min = Number.isFinite(config.min) ? config.min : 0;
    const rawMax = Number.isFinite(config.max) ? config.max : min + 1;
    const max = rawMax > min ? rawMax : min + 1;
    const span = Math.max(max - min, 1);
    const viewBoxWidth = 320;
    const viewBoxHeight = 68;
    const trackPadding = 6;
    const markerPadding = 6;
    const trackStart = trackPadding;
    const trackEnd = viewBoxWidth - trackPadding;
    const trackHeight = 10;
    const trackY = 36;
    const labelY = trackY - trackHeight / 2 - 8;
    const tickBaseY = trackY + trackHeight / 2;
    const tickLabelY = tickBaseY + 12;

    svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    const mapValue = (val) => {
      const ratio = clamp((Number(val) - min) / span, 0, 1);
      return trackStart + ratio * (trackEnd - trackStart);
    };

    const track = createSvgElement('rect', {
      class: 'chart-scale__track',
      x: trackStart,
      y: trackY - trackHeight / 2,
      width: trackEnd - trackStart,
      height: trackHeight,
      rx: trackHeight / 2,
      ry: trackHeight / 2
    });
    svg.append(track);

    if (highlight && Number.isFinite(highlight.from) && Number.isFinite(highlight.to)) {
      const from = Math.min(highlight.from, highlight.to);
      const to = Math.max(highlight.from, highlight.to);
      const startX = mapValue(from);
      const endX = mapValue(to);
      const width = Math.max(endX - startX, 1);
      const highlightRect = createSvgElement('rect', {
        class: 'chart-scale__highlight',
        x: startX,
        y: trackY - trackHeight / 2,
        width,
        height: trackHeight,
        rx: trackHeight / 2,
        ry: trackHeight / 2
      });
      svg.append(highlightRect);
    }

    const segments = Array.isArray(config.segments) ? config.segments.slice().sort((a, b) => {
      const aVal = Number.isFinite(a.from) ? a.from : Number.isFinite(a.to) ? a.to : min;
      const bVal = Number.isFinite(b.from) ? b.from : Number.isFinite(b.to) ? b.to : min;
      return aVal - bVal;
    }) : [];

    segments.forEach((segment) => {
      const from = Number.isFinite(segment.from) ? segment.from : min;
      const to = Number.isFinite(segment.to) ? segment.to : max;
      const startX = mapValue(Math.min(Math.max(from, min), max));
      const endX = mapValue(Math.max(Math.min(to, max), min));
      const width = Math.max(endX - startX, 1);
      const rect = createSvgElement('rect', {
        class: `chart-scale__segment chart-scale__segment--${segment.tone || 'neutral'}`,
        x: startX,
        y: trackY - trackHeight / 2,
        width,
        height: trackHeight,
        rx: trackHeight / 2,
        ry: trackHeight / 2
      });
      svg.append(rect);
      const labelText = segment.label || '';
      const detailText = segment.detail || '';
      if (labelText || detailText) {
        const text = createSvgElement('text', {
          class: 'chart-scale__segment-label',
          x: startX + width / 2,
          y: labelY
        });
        if (labelText) {
          text.textContent = labelText;
        }
        if (detailText) {
          const detail = createSvgElement('tspan', {
            class: 'chart-scale__segment-sub',
            x: startX + width / 2,
            dy: labelText ? 4.5 : 0
          });
          detail.textContent = detailText;
          text.append(detail);
        }
        svg.append(text);
      }
    });

    const tickGroup = createSvgElement('g');
    const seenTicks = new Set();
    (Array.isArray(config.ticks) ? config.ticks : []).forEach((tick) => {
      if (!Number.isFinite(tick.at) || seenTicks.has(tick.at)) return;
      seenTicks.add(tick.at);
      const x = mapValue(tick.at);
      const line = createSvgElement('line', {
        class: 'chart-scale__tick',
        x1: x,
        y1: tickBaseY,
        x2: x,
        y2: tickBaseY + 6
      });
      tickGroup.append(line);
      const label = createSvgElement('text', {
        class: 'chart-scale__tick-label',
        x,
        y: tickLabelY
      });
      label.textContent = formatScaleTickLabel(tick.label, tick.at, unit);
      tickGroup.append(label);
    });
    svg.append(tickGroup);

    const hasValue = Number.isFinite(value);
    const clampedValue = hasValue ? clamp(value, min, max) : min;
    const mapped = mapValue(clampedValue);
    const markerX = clamp(mapped, trackStart + markerPadding, trackEnd - markerPadding);
    const markerTone = determineSegmentTone(segments, hasValue ? value : null);
    const markerGroup = createSvgElement('g', {
      class: `chart-scale__marker chart-scale__marker--${markerTone}`,
      transform: `translate(${markerX} ${trackY})`
    });
    const markerLine = createSvgElement('line', { class: 'chart-scale__marker-line', x1: 0, y1: 0, x2: 0, y2: -12 });
    const markerDot = createSvgElement('circle', { class: 'chart-scale__marker-dot', cx: 0, cy: 0, r: 3.2 });
    const labelGroup = createSvgElement('g', { class: 'chart-scale__marker-label', transform: 'translate(0,-16)' });
    const labelBg = createSvgElement('rect', { class: 'chart-scale__marker-label-bg', x: -24, y: -8, width: 48, height: 16 });
    const labelText = createSvgElement('text', { class: 'chart-scale__marker-value', x: 0, y: 0 });
    labelText.textContent = formatWithUnit(hasValue ? value : null, unit, decimals);
    labelGroup.append(labelBg, labelText);
    markerGroup.append(markerLine, markerDot, labelGroup);
    svg.append(markerGroup);
    adjustMarkerLabel(labelGroup, markerX, viewBoxWidth, trackPadding);
  }

  function formatScaleTickLabel(label, fallbackValue, unit) {
    if (typeof label === 'string' && label.trim().length) {
      return label;
    }
    return formatScaleTick(fallbackValue, unit);
  }

  function determineSegmentTone(segments, value) {
    if (!Number.isFinite(value)) {
      return 'neutral';
    }
    for (const segment of segments) {
      const from = Number.isFinite(segment.from) ? segment.from : -Infinity;
      const to = Number.isFinite(segment.to) ? segment.to : Infinity;
      if (value >= from && value <= to) {
        return segment.tone || 'neutral';
      }
    }
    if (segments.length === 0) {
      return 'neutral';
    }
    return value < (segments[0].from ?? value) ? segments[0].tone || 'neutral' : segments[segments.length - 1].tone || 'neutral';
  }

  function createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value == null) return;
      element.setAttribute(key, String(value));
    });
    return element;
  }

  function adjustMarkerLabel(group, markerX, viewBoxWidth, padding) {
    if (!group) return;
    const rect = group.querySelector('rect');
    const text = group.querySelector('text');
    if (!rect || !text) return;
    const box = text.getBBox();
    const paddingX = 6;
    const paddingY = 3;
    const width = box.width + paddingX * 2;
    const height = box.height + paddingY * 2;
    rect.setAttribute('x', (-width / 2).toFixed(2));
    rect.setAttribute('y', (box.y - paddingY).toFixed(2));
    rect.setAttribute('width', width.toFixed(2));
    rect.setAttribute('height', height.toFixed(2));
    const leftEdge = markerX - width / 2;
    const rightEdge = markerX + width / 2;
    let shift = 0;
    if (leftEdge < padding) {
      shift = padding - leftEdge;
    } else if (rightEdge > viewBoxWidth - padding) {
      shift = (viewBoxWidth - padding) - rightEdge;
    }
    group.setAttribute('transform', `translate(${shift.toFixed(2)},-16)`);
  }

  function formatScaleTick(value, unit) {
    if (!Number.isFinite(value)) {
      return formatWithUnit(null, unit, 0);
    }
    const decimals = Math.abs(value) < 10 && unit !== 'ppm' ? 1 : 0;
    return formatWithUnit(value, unit, decimals);
  }

  function getDefinitionForMetric(metric) {
    const chartKey = METRIC_TO_CHART_KEY[metric];
    if (!chartKey) return null;
    return CHART_DEFINITIONS[chartKey] || null;
  }

  function openChartModal(metric) {
    const definition = getDefinitionForMetric(metric);
    if (!definition || !ui.modalRoot || !ui.modalCanvas) return;
    modalConfig.assign({ metric, loading: true, error: null, empty: false });
    updateModalTabs(modalConfig.get().rangeKey);
    updateModalInsight(metric);
    refreshModalDetails(metric);
    ui.modalTitle.textContent = definition.title || metricLabel(metric);
    ui.modalSub.textContent = 'Lade Daten …';
    lockBodyScroll();
    ui.modalRoot.hidden = false;
    attachModalResizeHandlers();
    activateModalFocusTrap(ui.modalRoot, ui.modalContent);
    queueModalLayoutSync();
    queueMicrotask(() => {
      loadModalChart(metric, false).catch(handleModalError);
    });
  }

  function closeChartModal() {
    if (!ui.modalRoot || ui.modalRoot.hidden) return;
    if (state.modalAbortController) {
      try {
        state.modalAbortController.abort();
      } catch (error) {
        /* ignore */
      }
      state.modalAbortController = null;
    }
    ui.modalRoot.hidden = true;
    releaseModalFocusTrap(ui.modalRoot);
    detachModalResizeHandlers();
    if (state.modalLayoutFrame) {
      window.cancelAnimationFrame(state.modalLayoutFrame);
      state.modalLayoutFrame = 0;
    }
    if (ui.modalTabList) {
      ui.modalTabList.style.removeProperty('--tabs-offset');
    }
    if (!ui.circadianModal || ui.circadianModal.hidden) {
      unlockBodyScroll();
    }
    teardownModalChart();
    modalConfig.assign({ metric: null, loading: false, error: null, empty: false });
  }

  async function loadModalChart(metric, force) {
    const activeMetric = metric || modalConfig.get().metric;
    if (!activeMetric || !ui.modalCanvas) return;
    const definition = getDefinitionForMetric(activeMetric);
    if (!definition) return;
    const snapshot = modalConfig.get();
    const rangeKey = snapshot.rangeKey in TIME_RANGES ? snapshot.rangeKey : '24h';
    const range = TIME_RANGES[rangeKey];
    state.modalRequestToken += 1;
    const requestId = state.modalRequestToken;
    if (state.modalAbortController) {
      try {
        state.modalAbortController.abort();
      } catch (error) {
        /* ignore */
      }
    }
    const controller = new AbortController();
    state.modalAbortController = controller;
    modalConfig.assign({ loading: true, error: null, empty: false });
    try {
      const data = await ensureSeries(definition, range, force, { signal: controller.signal });
      if (state.modalRequestToken !== requestId) {
        if (state.modalAbortController === controller) {
          state.modalAbortController = null;
        }
        return;
      }
      const hasData = definition.metrics.some(
        (metricKey) => Array.isArray(data[metricKey]) && data[metricKey].length > 1
      );
      applyModalHeading(definition, range, activeMetric);
      if (!hasData) {
        teardownModalChart();
        modalConfig.assign({ loading: false, error: null, empty: true });
        if (state.modalAbortController === controller) {
          state.modalAbortController = null;
        }
        return;
      }
      renderModalChart(definition, data, range, activeMetric);
      modalConfig.assign({ loading: false, error: null, empty: false });
      if (state.modalAbortController === controller) {
        state.modalAbortController = null;
      }
    } catch (error) {
      if (state.modalRequestToken !== requestId) {
        if (state.modalAbortController === controller) {
          state.modalAbortController = null;
        }
        return;
      }
      if (error?.name === 'AbortError') {
        if (state.modalAbortController === controller) {
          state.modalAbortController = null;
        }
        return;
      }
      if (state.modalAbortController === controller) {
        state.modalAbortController = null;
      }
      handleModalError(error);
    }
  }

  function renderModalChart(definition, data, range, activeMetric) {
    if (!ui.modalCanvas) return;
    const ctx = ui.modalCanvas.getContext('2d');
    if (!ctx) return;
    applyModalHeading(definition, range, activeMetric);
    const datasets = definition.metrics.map((metric, index) => {
      const color = definition.colors[index % definition.colors.length];
      return {
        label: METRIC_CONFIG[metric]?.label || metric,
        data: clonePoints(data[metric] || []),
        borderColor: color,
        backgroundColor: colorWithAlpha(color, 0.12),
        tension: 0.35,
        fill: 'start',
        pointRadius: 0,
        pointHitRadius: 18,
        pointHoverRadius: 4,
        borderWidth: 2,
        spanGaps: true
      };
    });
    const tooltipEnabled = datasets.some((dataset) => Array.isArray(dataset.data) && dataset.data.length > 1);
    const container = ui.modalCanvas.closest('.chart-modal__canvas');
    if (container) {
      container.classList.toggle('is-empty', !tooltipEnabled);
    }

    const timeUnit = range.range === '24h' ? 'hour' : range.range === '7d' ? 'day' : 'week';
    const guides = buildTargetGuides(activeMetric || definition.metrics[0]);
    const tooltipLabel = (context) => {
      const metricKey = definition.metrics[context.datasetIndex];
      const cfg = METRIC_CONFIG[metricKey];
      const valueLabel = formatWithUnit(context.parsed.y, cfg?.unit || '', cfg?.decimals ?? 0);
      const status = determineStatus(metricKey, context.parsed.y);
      const suffix = status?.label ? ` – ${status.label}` : '';
      return `${context.dataset.label}: ${valueLabel}${suffix}`;
    };

    if (!state.modalChart) {
      state.modalChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        plugins: [targetGuidePlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 8, right: 12, bottom: 8, left: 6 } },
          plugins: {
            legend: { labels: { color: '#475569', boxWidth: 12, boxHeight: 12, padding: 12 } },
            tooltip: {
              enabled: tooltipEnabled,
              callbacks: { label: tooltipLabel }
            },
            targetGuides: { guides }
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
              ticks: {
                color: '#94a3b8',
                maxTicksLimit: 6,
                callback(value) {
                  return formatScaleTick(value, definition.yTitle);
                }
              },
              grid: { color: 'rgba(148, 163, 184, 0.12)', lineWidth: 1, drawBorder: false },
              border: { display: false },
              suggestedMin: definition.yBounds?.min,
              suggestedMax: definition.yBounds?.max
            }
          }
        }
      });
      recordTooltipPreference(state.modalChart, tooltipEnabled);
    } else {
      resetTooltipState(state.modalChart);
      state.modalChart.data.datasets = datasets;
      const targetGuideOptions = state.modalChart.options.plugins.targetGuides
        || (state.modalChart.options.plugins.targetGuides = {});
      targetGuideOptions.guides = guides;
      state.modalChart.options.plugins.tooltip = state.modalChart.options.plugins.tooltip || {};
      state.modalChart.options.plugins.tooltip.callbacks =
        state.modalChart.options.plugins.tooltip.callbacks || {};
      state.modalChart.options.plugins.tooltip.callbacks.label = tooltipLabel;
      state.modalChart.options.plugins.tooltip.enabled = tooltipEnabled;
      state.modalChart.options.scales.x.time.unit = timeUnit;
      state.modalChart.options.scales.y.title.text = definition.yTitle;
      state.modalChart.options.scales.y.suggestedMin = definition.yBounds?.min;
      state.modalChart.options.scales.y.suggestedMax = definition.yBounds?.max;
      recordTooltipPreference(state.modalChart, tooltipEnabled);
    }
    syncChartInteractionState(state.modalChart, tooltipEnabled);
    scheduleChartUpdate(state.modalChart);
    scheduleModalResize();
    queueModalLayoutSync();
  }

  function handleModalError(error) {
    console.warn('Modal-Chart konnte nicht geladen werden', error);
    const message = typeof error === 'string' ? error : error?.message || 'Diagramm konnte nicht geladen werden.';
    modalConfig.assign({ loading: false, error: message, empty: false });
    showToast(message);
  }

  function retryModalChart() {
    const snapshot = modalConfig.get();
    if (!snapshot.metric) {
      return;
    }
    modalConfig.assign({ error: null, loading: true });
    queueMicrotask(() => {
      loadModalChart(snapshot.metric, true).catch(handleModalError);
    });
  }

  function applyModalHeading(definition, range, activeMetric) {
    if (!definition) return;
    const label = METRIC_CONFIG[activeMetric || definition.metrics[0]]?.label
      || definition.title
      || definition.key;
    if (ui.modalTitle) {
      ui.modalTitle.textContent = label;
    }
    if (ui.modalSub) {
      const parts = [];
      if (typeof range?.label === 'string' && range.label.trim().length) {
        parts.push(range.label);
      } else if (typeof range?.range === 'string' && range.range.trim().length) {
        parts.push(range.range);
      }
      if (definition.sub) {
        parts.push(definition.sub);
      } else if (definition.yTitle) {
        parts.push(definition.yTitle);
      }
      ui.modalSub.textContent = parts.filter(Boolean).join(' • ');
    }
  }

  function teardownModalChart() {
    if (state.modalChart) {
      try {
        state.modalChart.destroy();
      } catch (error) {
        console.warn('Diagramm konnte nicht bereinigt werden', error);
      }
      state.modalChart = null;
    }
    if (ui.modalCanvas) {
      const ctx = ui.modalCanvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.clearRect(0, 0, ui.modalCanvas.width || 0, ui.modalCanvas.height || 0);
        ctx.restore();
      }
    }
  }

  function buildTargetGuides(metric) {
    const entries = TARGET_GUIDES[metric] || [];
    const guides = [];
    entries.forEach((entry) => {
      if (entry.dynamic === 'lux' || entry.dynamic === 'cct') {
        const phase = resolveCircadianPhase();
        const range = entry.dynamic === 'lux' ? phase.luxRange : phase.cctRange;
        if (!Array.isArray(range) || range.length < 2) return;
        guides.push({
          min: range[0],
          max: range[1],
          color: STATUS_TONES.good,
          label: `${phase.title}: ${formatNumber(range[0], 0)}–${formatNumber(range[1], 0)}${NARROW_SPACE}${entry.unit}`
        });
        return;
      }
      if (entry.min != null && entry.max != null) {
        guides.push({
          min: entry.min,
          max: entry.max,
          color: STATUS_TONES.good,
          label: entry.label || `${formatNumber(entry.min, 0)}–${formatNumber(entry.max, 0)}${NARROW_SPACE}${entry.unit || ''}`.trim()
        });
        return;
      }
      if (entry.value != null) {
        guides.push({
          value: entry.value,
          color: STATUS_TONES.good,
          label: entry.label || `${formatWithUnit(entry.value, entry.unit || '', 0)}`
        });
      }
    });
    return guides;
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape') {
      closeChartModal();
      closeCircadianModal();
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
          const ts = coerceTimestamp(entry[0]);
          const val = coerceNumeric(entry[1]);
          return Number.isFinite(ts) && Number.isFinite(val) ? [ts, val] : null;
        }
        if (typeof entry === 'object') {
          const ts = coerceTimestamp('x' in entry ? entry.x : entry.ts);
          const val = coerceNumeric('y' in entry ? entry.y : entry.value);
          return Number.isFinite(ts) && Number.isFinite(val) ? [ts, val] : null;
        }
        return null;
      })
      .filter((entry) => Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1]));
    const containsMilliseconds = normalized.some((entry) => entry[0] > 1e11);
    return containsMilliseconds
      ? normalized.map(([ts, val]) => [ts / 1000, val])
      : normalized;
  }

  function coerceTimestamp(value) {
    if (value == null) return NaN;
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? time / 1000 : NaN;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed / 1000;
      }
    }
    return NaN;
  }

  function coerceNumeric(value) {
    if (value == null) return NaN;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value === 'string') {
      const cleaned = value.replace(/\u202f/g, '').replace(/\s+/g, '');
      const normalized = cleaned.replace(/,/g, '.');
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : NaN;
    }
    return NaN;
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
    if (length > 400) return 5;
    if (length > 120) return 4;
    return 3;
  }

  function limitPoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return [];
    }
    if (points.length <= MAX_POINTS) {
      return clonePoints(points);
    }
    const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
    const limited = [];
    for (let index = 0; index < points.length; index += step) {
      const point = points[index];
      if (!point) continue;
      limited.push({ x: point.x, y: point.y });
    }
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      const tail = limited[limited.length - 1];
      if (!tail || tail.x !== lastPoint.x || tail.y !== lastPoint.y) {
        limited.push({ x: lastPoint.x, y: lastPoint.y });
      }
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

  function dedupePoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return [];
    }
    const sorted = points
      .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      .slice()
      .sort((a, b) => a.x - b.x);
    if (sorted.length === 0) {
      return [];
    }
    const deduped = [];
    let lastX = null;
    for (const point of sorted) {
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      if (lastX != null && Math.abs(x - lastX) < 1) {
        deduped[deduped.length - 1] = { x, y };
      } else {
        deduped.push({ x, y });
        lastX = x;
      }
    }
    return deduped;
  }

  function clonePoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return [];
    }
    const clones = [];
    for (const point of points) {
      if (!point) continue;
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      clones.push({ x, y });
    }
    return clones;
  }

  async function refreshPressureTrend() {
    if (!state.now?.Luftdruck) return;
    if (Date.now() - state.lastPressureFetch < PRESSURE_REFRESH_MS) return;
    state.lastPressureFetch = Date.now();
    try {
      const params = new URLSearchParams({ name: 'Luftdruck', range: '3h', step: '15m', win: '30m' });
      const response = await fetch(`/api/series?${params.toString()}`);
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
            icon: '/assets/logo.png',
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
    const host = typeof window.location.hostname === 'string' ? window.location.hostname.toLowerCase() : '';
    const allowedHosts = new Set(['localhost', 'airguardpi.local']);
    const secureContext = Boolean(window.isSecureContext);
    const isAllowedHost = allowedHosts.has(host);
    if (!secureContext && !isAllowedHost) {
      console.info('SW skipped (insecure)');
      if (ui.pwaStatusBadge) {
        ui.pwaStatusBadge.textContent = 'Offline-Cache deaktiviert (kein gültiges Zertifikat)';
        ui.pwaStatusBadge.hidden = false;
      }
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
        console.info('Service Worker registriert');
        if (ui.pwaStatusBadge) {
          ui.pwaStatusBadge.hidden = true;
        }
      })
      .catch((error) => {
        console.info('Service Worker Registrierung fehlgeschlagen', error?.message || 'Unbekannter Fehler');
        if (ui.pwaStatusBadge) {
          ui.pwaStatusBadge.textContent = 'Offline-Cache deaktiviert (Registrierung fehlgeschlagen)';
          ui.pwaStatusBadge.hidden = false;
        }
      });
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
      await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      await fetch('/push/test', { method: 'POST' });
    } catch (error) {
      console.warn('Push-Subscription fehlgeschlagen', error);
    }
  }

  function handleError(error) {
    console.error(error);
    showToast(typeof error === 'string' ? error : error?.message || 'Unbekannter Fehler');
  }
})();
