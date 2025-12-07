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
  function assignGuides(options, guides) {
    if (!options) {
      return;
    }
    const target = Array.isArray(options.guides) ? options.guides : (options.guides = []);
    target.length = 0;
    if (!Array.isArray(guides) || guides.length === 0) {
      return;
    }
    guides.forEach((guide) => {
      if (guide && typeof guide === 'object') {
        target.push({ ...guide });
      }
    });
  }

  function debounce(fn, wait = 120) {
    let timer = null;
    return (...args) => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        try {
          fn.apply(null, args);
        } catch (error) {
          console.warn('Debounced Funktion fehlgeschlagen', error);
        }
      }, wait);
    };
  }

  const targetGuidePlugin = {
    id: 'targetGuides',
    defaults: {
      guides: []
    },
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

  const tooltipGuardPlugin = {
    id: 'tooltipGuard',
    beforeInit(chart) {
      const hasData = chartHasUsableData(chart);
      syncTooltipState(chart, hasData);
      if (!hasData) {
        clearActiveElements(chart);
      }
    },
    afterDatasetsUpdate(chart) {
      const hasData = chartHasUsableData(chart);
      syncTooltipState(chart, hasData);
      if (!hasData) {
        clearActiveElements(chart);
      }
    },
    beforeEvent(chart) {
      const hasData = chartHasUsableData(chart);
      if (!hasData) {
        clearActiveElements(chart);
        syncTooltipState(chart, false);
        return false;
      }
      return true;
    }
  };

  const safeTooltipPlugin = {
    id: 'safeTooltip',
    beforeEvent(chart, args) {
      const tooltip = chart.tooltip;
      if (!tooltip || !Array.isArray(tooltip._active)) return;
      tooltip._active = tooltip._active.filter(
        (item) => item && item.element && typeof item.element.x === 'number'
      );
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
        tooltip: chart.options?.plugins?.tooltip
          && Object.prototype.hasOwnProperty.call(chart.options.plugins.tooltip, 'enabled')
            ? chart.options.plugins.tooltip.enabled
            : undefined,
        preferredTooltip: undefined
      };
    }
  }

  function syncTooltipState(chart, hasData) {
    if (!chart) return;
    ensureInteractionBackups(chart);
    const store = chart.$_safeInteraction;
    const tooltipOptions = chart.options?.plugins?.tooltip;
    if (!tooltipOptions) {
      return;
    }
    if (hasData) {
      const target = store.preferredTooltip ?? store.tooltip;
      if (target === undefined) {
        delete tooltipOptions.enabled;
        if (chart.tooltip?.options) {
          delete chart.tooltip.options.enabled;
        }
      } else {
        tooltipOptions.enabled = target;
        if (chart.tooltip?.options) {
          chart.tooltip.options.enabled = target;
        }
      }
    } else {
      if (store.preferredTooltip === undefined) {
        store.preferredTooltip = tooltipOptions.enabled;
      }
      tooltipOptions.enabled = false;
      if (chart.tooltip?.options) {
        chart.tooltip.options.enabled = false;
      }
    }
  }

  function safeClearTooltip(chart) {
    if (!chart || typeof chart.setActiveElements !== 'function' || !chart.tooltip) {
      return;
    }
    const activeElements = typeof chart.getActiveElements === 'function'
      ? chart.getActiveElements()
      : [];
    if (!activeElements || activeElements.length === 0) return;
    try {
      chart.setActiveElements([]);
      if (typeof chart.tooltip.update === 'function') {
        chart.tooltip.update();
      }
    } catch (error) {
      console.warn('Tooltip konnte nicht zurückgesetzt werden', error);
    }
  }

  function clearActiveElements(chart) {
    safeClearTooltip(chart);
  }

  function recordTooltipPreference(chart, enabled) {
    if (!chart) return;
    ensureInteractionBackups(chart);
    if (chart.$_safeInteraction) {
      chart.$_safeInteraction.preferredTooltip = enabled;
    }
  }

  Chart.register(targetGuidePlugin, tooltipGuardPlugin, safeTooltipPlugin);
  Chart.defaults.font.family = "'Inter','Segoe UI',system-ui,sans-serif";
  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.2)';
  Chart.defaults.elements.line.borderWidth = 2.25;
  Chart.defaults.elements.line.tension = 0.32;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hitRadius = 10;
  Chart.defaults.scale.grid.color = 'rgba(148, 163, 184, 0.14)';
  Chart.defaults.scale.grid.borderColor = 'rgba(148, 163, 184, 0.18)';
  Chart.defaults.scale.ticks.color = '#94a3b8';
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
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.9)';
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.caretSize = 6;
    Chart.defaults.plugins.tooltip.cornerRadius = 12;
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
        safeClearTooltip(chart);
        chart.update(entry.mode);
      } catch (error) {
        console.warn('Chart-Update fehlgeschlagen', error);
      }
    });
  }

  function createConfigStore(initialState = {}) {
    let state = { ...initialState };
    const listeners = new Set();
    let notifyScheduled = false;
    let emitDepth = 0;
    let updating = false;
    let pendingPatch = null;
    let flushScheduled = false;
    const DEV_ASSERTS = (() => {
      try {
        if (window?.AIRGUARD_DISABLE_ASSERTS) return false;
        const host = window?.location?.hostname || '';
        return host === 'localhost' || host.endsWith('.local') || host === '';
      } catch (error) {
        return false;
      }
    })();

    /**
     * Hinweis für Listener: Subscriber dürfen den Store innerhalb einer Benachrichtigung
     * nicht erneut mutieren. Das Zeichnen/Lesen ist erlaubt, Mutationen lösen jedoch
     * in der Entwicklungsumgebung einen Assert aus und werden in Produktion ignoriert.
     */

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
      if (!changed) {
        return state;
      }
      state = next;
      notifyOnce();
      return state;
    }

    function notifyOnce() {
      if (notifyScheduled) return;
      notifyScheduled = true;
      queueMicrotask(() => {
        notifyScheduled = false;
        if (!listeners.size) {
          return;
        }
        const snapshot = state;
        listeners.forEach((listener) => invokeListener(listener, snapshot));
      });
    }

    function invokeListener(listener, snapshot) {
      if (typeof listener !== 'function') {
        return;
      }
      emitDepth += 1;
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('Konfigurations-Listener Fehler', error);
      } finally {
        emitDepth = Math.max(emitDepth - 1, 0);
      }
    }

    function schedulePendingFlush() {
      if (flushScheduled) {
        return;
      }
      flushScheduled = true;
      queueMicrotask(() => {
        flushScheduled = false;
        if (!pendingPatch) {
          return;
        }
        const patch = pendingPatch;
        pendingPatch = null;
        set(patch);
      });
    }

    function set(patch) {
      if (!patch || typeof patch !== 'object') {
        return state;
      }
      if (emitDepth > 0) {
        const message = 'Konfigurations-Listener dürfen createConfigStore.set nicht aufrufen.';
        console.warn(message);
        pendingPatch = { ...(pendingPatch || {}), ...patch };
        schedulePendingFlush();
        return state;
      }
      if (updating) {
        pendingPatch = { ...(pendingPatch || {}), ...patch };
        schedulePendingFlush();
        return state;
      }
      updating = true;
      try {
        assign(patch);
      } finally {
        updating = false;
      }
      if (pendingPatch) {
        schedulePendingFlush();
      }
      return state;
    }

    function subscribe(listener, emitImmediately = false) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      listeners.add(listener);
      if (emitImmediately) {
        invokeListener(listener, state);
      }
      return () => listeners.delete(listener);
    }

    return { get, set, assign, subscribe };
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
      { label: 'Zu dunkel', min: 0, max: 100, tone: 'poor', display: `< 100${NARROW_SPACE}lx` },
      { label: 'Gemütlich', min: 100, max: 500, tone: 'good', display: `100–500${NARROW_SPACE}lx` },
      { label: 'Tageslicht', min: 500, max: 1000, tone: 'excellent', display: `500–1 000${NARROW_SPACE}lx` },
      { label: 'Sehr hell', min: 1500, max: 2000, tone: 'poor', display: `> 1 500${NARROW_SPACE}lx` }
    ],
    cct: [
      { label: 'Abendwarm', min: 2200, max: 3200, tone: 'elevated', display: `2 200–3 200${NARROW_SPACE}K` },
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
  const FETCH_RETRY_DELAYS = [500, 1000];
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
    ['PM10', ['PM10', 'pm10']],
    ['Luftdruck', ['Luftdruck', 'pressure_hpa', 'pressure']]
  ]);

  const modalConfig = createConfigStore({
    metric: null,
    rangeKey: '24h',
    loading: false,
    error: null,
    empty: false
  });

const METRIC_CONFIG = {
  CO2:           { unit: 'ppm',   decimals: 0, label: 'CO₂' },
  'PM1.0':       { unit: 'µg/m³', decimals: 1, label: 'PM1' },
  'PM2.5':       { unit: 'µg/m³', decimals: 1, label: 'PM2.5' },
  PM10:          { unit: 'µg/m³', decimals: 1, label: 'PM10' },
  TVOC:          { unit: 'ppb',   decimals: 0, label: 'TVOC' },
  Temperatur:    { unit: '°C',   decimals: 1, label: 'Temperatur' },
  'rel. Feuchte':{ unit: '%',    decimals: 1, label: 'rel. Feuchte' },
  Lux:           { unit: 'lx',   decimals: 0, label: 'Lux' },
  Luftdruck:     { unit: 'hPa',  decimals: 1, label: 'Luftdruck' },
  Farbtemperatur:{ unit: 'K',    decimals: 0, label: 'CCT' }
};

 const METRIC_ICONS = {
   CO2: 'icon-cloud',
   PM10: 'icon-dots',
   'PM2.5': 'icon-dots',
   'PM1.0': 'icon-dots',
   TVOC: 'icon-flask',
   Temperatur: 'icon-thermometer',
   'rel. Feuchte': 'icon-droplet',
   Luftdruck: 'icon-gauge'
 };


  const NOW_KEY_ALIASES = new Map([
  ['temperatur', 'Temperatur'],
  ['temperature', 'Temperatur'],
  ['temp_final', 'Temperatur'],
  ['co2', 'CO2'],
  ['co2_ppm', 'CO2'],
  ['pm1', 'PM1.0'],
  ['pm1.0', 'PM1.0'],
  ['pm25', 'PM2.5'],
  ['pm2_5', 'PM2.5'],
  ['pm10', 'PM10'],
  ['tvoc', 'TVOC'],
  ['voc', 'TVOC'],
  ['humidity', 'rel. Feuchte'],
  ['rel_feuchte', 'rel. Feuchte'],
  ['pressure_hpa', 'Luftdruck'],
  ['pressure', 'Luftdruck'],
  ['lux', 'Lux'],
  ['cct_k', 'Farbtemperatur'],
  ['cct', 'Farbtemperatur']
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
        { from: 400, to: 800, label: 'Hervorragend', tone: 'excellent' },
        { from: 800, to: 1000, label: 'Gut', tone: 'good' },
        { from: 1000, to: 1400, label: 'Erhöht', tone: 'elevated' },
        { from: 1400, to: 2000, label: 'Schlecht', tone: 'poor' }
      ],
      ticks: [{ at: 400 }, { at: 800 }, { at: 1000 }, { at: 1400 }, { at: 2000 }]
    },
    Temperatur: {
      unit: '°C',
      min: 16,
      max: 30,
      segments: [
        { from: 16, to: 18, label: 'Zu kalt', tone: 'poor', detail: `< 18${NARROW_SPACE}°C` },
        { from: 18, to: 20, label: 'Etwas kühl', tone: 'good' },
        { from: 20, to: 23, label: 'Wohlfühlen', tone: 'excellent' },
        { from: 23, to: 25, label: 'Etwas warm', tone: 'good' },
        { from: 25, to: 30, label: 'Zu warm', tone: 'poor', detail: `≥ 25${NARROW_SPACE}°C` }
      ],
      ticks: [{ at: 16 }, { at: 18 }, { at: 20 }, { at: 23 }, { at: 25 }, { at: 30 }]
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
        { from: 20, to: 30, label: 'Sehr trocken', tone: 'poor', detail: '< 30%' },
        { from: 30, to: 40, label: 'Trocken', tone: 'elevated' },
        { from: 40, to: 60, label: 'Wohlfühlfeuchte', tone: 'excellent' },
        { from: 60, to: 70, label: 'Etwas feucht', tone: 'elevated' },
        { from: 70, to: 80, label: 'Sehr feucht', tone: 'poor', detail: '≥ 70%' }
      ],
      ticks: [{ at: 20 }, { at: 30 }, { at: 40 }, { at: 60 }, { at: 70 }, { at: 80 }]
    }
  };

  const METRIC_SCALE_CONFIG = {
    CO2: {
      bands: [
        { tone: 'excellent', min: 400, max: 800, label: 'Hervorragend', detail: 'Optimaler CO₂-Bereich' },
        { tone: 'good', min: 800, max: 1000, label: 'Gut', detail: 'Unauffällige Werte' },
        { tone: 'elevated', min: 1000, max: 1400, label: 'Erhöht', detail: 'Lüften empfohlen' },
        { tone: 'poor', min: 1400, max: 2000, label: 'Schlecht', detail: 'Dringend lüften' }
      ]
    },
    'PM2.5': {
      bands: [
        { tone: 'excellent', min: 0, max: 5, label: 'Sehr niedrig', detail: 'Hervorragend' },
        { tone: 'good', min: 5, max: 12, label: 'Niedrig', detail: 'Gut' },
        { tone: 'elevated', min: 12, max: 25, label: 'Erhöht', detail: 'Belastung steigt' },
        { tone: 'poor', min: 25, max: 60, label: 'Stark erhöht', detail: 'Gesundheitlich ungünstig' }
      ]
    },
    'PM1.0': {
      bands: [
        { tone: 'excellent', min: 0, max: 5, label: 'Sehr niedrig', detail: 'Hervorragend' },
        { tone: 'good', min: 5, max: 12, label: 'Niedrig', detail: 'Gut' },
        { tone: 'elevated', min: 12, max: 35, label: 'Erhöht', detail: 'Belastung steigt' },
        { tone: 'poor', min: 35, max: 60, label: 'Stark erhöht', detail: 'Gesundheitlich ungünstig' }
      ]
    },
    PM10: {
      bands: [
        { tone: 'excellent', min: 0, max: 20, label: 'Sehr niedrig', detail: 'Hervorragend' },
        { tone: 'good', min: 20, max: 40, label: 'Niedrig', detail: 'Gut' },
        { tone: 'elevated', min: 40, max: 60, label: 'Erhöht', detail: 'Belastung steigt' },
        { tone: 'poor', min: 60, max: 120, label: 'Stark erhöht', detail: 'Gesundheitlich ungünstig' }
      ]
    },
    TVOC: {
      bands: [
        { tone: 'excellent', min: 0, max: 150, label: 'Sehr niedrig', detail: 'Kaum Ausdünstungen' },
        { tone: 'good', min: 150, max: 300, label: 'Niedrig', detail: 'Unauffällig' },
        { tone: 'elevated', min: 300, max: 600, label: 'Erhöht', detail: 'Quellen prüfen' },
        { tone: 'poor', min: 600, max: 1200, label: 'Stark erhöht', detail: 'Lüften & Quellen meiden' }
      ]
    },
    Temperatur: {
      bands: [
        { tone: 'poor', min: 16, max: 18, label: 'Zu kalt', detail: 'Deutlich unter Komfortbereich' },
        { tone: 'elevated', min: 18, max: 20, label: 'Kühl', detail: 'Leicht kühl' },
        { tone: 'excellent', min: 20, max: 24, label: 'Ideal', detail: 'Komfortzone' },
        { tone: 'elevated', min: 24, max: 30, label: 'Warm', detail: 'Eher warm' }
      ]
    },
    'rel. Feuchte': {
      bands: [
        { tone: 'poor', min: 20, max: 30, label: 'Sehr trocken', detail: 'Deutlich unter Komfortbereich' },
        { tone: 'elevated', min: 30, max: 40, label: 'Trocken', detail: 'Unter Komfortbereich' },
        { tone: 'excellent', min: 40, max: 60, label: 'Ideal', detail: 'Optimal' },
        { tone: 'elevated', min: 60, max: 80, label: 'Feucht', detail: 'Schimmelrisiko steigt' }
      ]
    }
  };

  const METRIC_SCALE_ALIASES = {
    pm1: 'PM1.0',
    'pm1.0': 'PM1.0',
    pm25: 'PM2.5',
    'pm2.5': 'PM2.5',
    pm10: 'PM10',
    temperature: 'Temperatur',
    temp: 'Temperatur',
    humidity: 'rel. Feuchte',
    feuchte: 'rel. Feuchte'
  };

  const METRIC_INSIGHTS = {
    CO2: {
      sections: [
        { title: 'Bedeutung', text: 'CO₂ zeigt, wie viel verbrauchte Luft im Raum bleibt und ob genug Frischluft zirkuliert.' },
        { title: 'Gesunde Werte', text: '400–800 ppm hervorragend, 800–1000 ppm gut, 1000–1400 ppm erhöht, ab 1400 ppm schlecht.' },
        { title: 'Auswirkungen', text: 'Hohe CO₂-Werte mindern Wachheit und Konzentration; ab ~1400 ppm drohen Kopfschmerzen und Müdigkeit.' },
        { title: 'Verbesserung', text: 'Stoß- und Querlüften, Türspalt offen lassen, Lüftung oder Filter aktivieren sobald der Trend steigt.' }
      ],
      scale: {
        unit: 'ppm',
        min: 400,
        max: 2000,
        caption: 'Bewertung orientiert sich an Innenraumempfehlungen für CO₂.',
        bands: [
          { label: 'Hervorragend', min: 400, max: 800, tone: 'excellent' },
          { label: 'Gut', min: 800, max: 1000, tone: 'good' },
          { label: 'Erhöht', min: 1000, max: 1400, tone: 'elevated' },
          { label: 'Schlecht', min: 1400, max: 2000, tone: 'poor' }
        ]
      }
    },
    'PM2.5': {
      sections: [
        { title: 'Bedeutung', text: 'Feinstaub gelangt tief in die Lunge – besonders relevant bei längeren Aufenthalten im Raum.' },
        { title: 'Gesunde Werte', text: '≤ 5 µg/m³ hervorragend, ≤ 12 µg/m³ gut, ≤ 25 µg/m³ erhöht, > 25 µg/m³ schlecht.' },
        { title: 'Auswirkungen', text: 'Steigende PM2.5-Werte reizen Atemwege und erhöhen auf Dauer das Risiko für Entzündungen.' },
        { title: 'Verbesserung', text: 'Innenquellen reduzieren (Kochen, Kerzen, Staub), kurz und kräftig lüften, HEPA-Filter nutzen.' }
      ],
      scale: {
        unit: 'µg/m³',
        min: 0,
        max: 60,
        caption: 'Grenzwerte angelehnt an WHO-Empfehlungen für Feinstaub.',
        stops: [
          { value: 5, label: 'Hervorragend', tone: 'excellent' },
          { value: 12, label: 'Gut', tone: 'good' },
          { value: 25, label: 'Erhöht', tone: 'elevated' },
          { value: 50, label: 'Schlecht', tone: 'poor' }
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
          text: '≤ 5 µg/m³ hervorragend, ≤ 12 µg/m³ gut, ≤ 35 µg/m³ erhöht, > 35 µg/m³ schlecht.'
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
          { label: 'Hervorragend', min: 0, max: 5, tone: 'excellent' },
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
          text: '≤ 20 µg/m³ hervorragend, ≤ 40 µg/m³ gut, ≤ 60 µg/m³ erhöht, > 100 µg/m³ schlecht.'
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
          { label: 'Hervorragend', min: 0, max: 20, tone: 'excellent' },
          { label: 'Gut', min: 20, max: 40, tone: 'good' },
          { label: 'Erhöht', min: 40, max: 60, tone: 'elevated' },
          { label: 'Schlecht', min: 60, max: 120, tone: 'poor', display: `> 100${NARROW_SPACE}µg/m³` }
        ]
      }
    },
    TVOC: {
      sections: [
        { title: 'Bedeutung', text: 'TVOCs entstehen durch Ausdünstungen aus Möbeln, Farben, Reinigern oder Parfums.' },
        { title: 'Gesunde Werte', text: '≤ 150 ppb hervorragend, ≤ 300 ppb gut, ≤ 600 ppb erhöht, > 600 ppb schlecht.' },
        { title: 'Auswirkungen', text: 'Steigende TVOC-Werte können Kopfschmerzen, Reizungen oder Schwindel auslösen.' },
        { title: 'Verbesserung', text: 'Kurz und intensiv lüften, Duft- und Chemikalienquellen reduzieren, Filter prüfen.' }
      ],
      scale: {
        unit: 'ppb',
        min: 0,
        max: 1200,
        caption: 'Bewertung orientiert sich an Innenraum-Leitwerten für VOC.',
        stops: [
          { value: 150, label: 'Hervorragend', tone: 'excellent' },
          { value: 300, label: 'Gut', tone: 'good' },
          { value: 600, label: 'Erhöht', tone: 'elevated' },
          { value: 1000, label: 'Schlecht', tone: 'poor' }
        ]
      }
    },
    Temperatur: {
      sections: [
        { title: 'Bedeutung', text: 'Raumtemperatur beeinflusst direkt das Wohlbefinden, die Konzentration und den Schlaf.' },
        {
          title: 'Gesunde Werte',
          text: '20–23 °C Wohlfühlbereich, 18–19 °C leicht kühl, über 25 °C klar zu warm.'
        },
        { title: 'Auswirkungen', text: 'Kühle Räume können frösteln lassen; zu warme Luft macht träge und belastet den Schlaf.' },
        { title: 'Verbesserung', text: 'Heizung feinjustieren, beschatten oder lüften, um im 20–23 °C Komfortband zu bleiben.' }
      ],
      scale: {
        unit: '°C',
        min: 16,
        max: 30,
        caption: 'Bewertung orientiert sich an Empfehlungen für Innenraumtemperaturen.',
        bands: [
          { label: 'Zu kalt', min: 16, max: 18, tone: 'poor', display: `< 18${NARROW_SPACE}°C` },
          { label: 'Etwas kühl', min: 18, max: 20, tone: 'good' },
          { label: 'Wohlfühlen', min: 20, max: 23, tone: 'excellent' },
          { label: 'Etwas warm', min: 23, max: 25, tone: 'good' },
          { label: 'Zu warm', min: 25, max: 30, tone: 'poor', display: `≥ 25${NARROW_SPACE}°C` }
        ]
      }
    },
    'rel. Feuchte': {
      sections: [
        { title: 'Bedeutung', text: 'Gibt an, wie viel Wasserdampf die Luft enthält – wichtig für Wohlbefinden und Schimmelprävention.' },
        { title: 'Gesunde Werte', text: '40–60 % Wohlfühlfeuchte, 30–39 % trocken, ab 70 % sehr feucht.' },
        { title: 'Auswirkungen', text: 'Unter 30 % trocknen Schleimhäute aus; über 60 % steigt Schimmelgefahr.' },
        { title: 'Verbesserung', text: 'Bei Trockenheit befeuchten; bei Feuchte stoßlüften oder entfeuchten, um 40–60 % zu halten.' }
      ],
      scale: {
        unit: '%',
        min: 20,
        max: 80,
        caption: 'Komfortband nach Innenraumempfehlungen für relative Feuchte.',
        bands: [
          { label: 'Sehr trocken', min: 20, max: 30, tone: 'poor' },
          { label: 'Trocken', min: 30, max: 40, tone: 'elevated' },
          { label: 'Wohlfühl', min: 40, max: 60, tone: 'excellent' },
          { label: 'Etwas feucht', min: 60, max: 70, tone: 'elevated' },
          { label: 'Sehr feucht', min: 70, max: 80, tone: 'poor' }
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
        { title: 'Gesunde Werte', text: '980–1030 hPa üblich; darunter Tiefdruck, darüber Hochdruck.' },
        { title: 'Auswirkungen', text: 'Fällt der Druck, sind Kreislauf und Wetterfühligkeit häufiger belastet.' },
        { title: 'Verbesserung', text: 'Keine direkte Steuerung möglich – dient der Beobachtung von Wettertrends.' }
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
  TVOC: {
    key: 'TVOC',
    title: 'TVOC',
    metrics: ['TVOC'],
    colors: ['#3b82f6'],
    yTitle: 'ppb',
    yBounds: { min: 0, max: 1000 }
  },
  Temperatur: {
    key: 'Temperatur',
    title: 'Temperatur',
    metrics: ['Temperatur'],
    colors: ['#f97316'],
    yTitle: '°C',
    yBounds: { min: 15, max: 30 }
  },
  'rel. Feuchte': {
    key: 'rel. Feuchte',
    title: 'Relative Feuchte',
    metrics: ['rel. Feuchte'],
    colors: ['#06b6d4'],
    yTitle: '%',
    yBounds: { min: 0, max: 100 }
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

  const KEY_METRICS = ['CO2', 'TVOC', 'Temperatur', 'rel. Feuchte'];
  const TREND_METRICS = ['CO2', 'PM2.5', 'PM1.0', 'PM10', 'TVOC', 'Temperatur', 'rel. Feuchte', 'Luftdruck'];
  const SPARKLINE_METRICS = KEY_METRICS;
  const SWIPE_CLOSE_THRESHOLD = 80;
  const SWIPE_CLOSE_MAX_WIDTH = 768;

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
    coreCards: new Map(),
    sparklineCards: new Map(),
    statusCards: new Map(),
    lastUpdated: null,
    healthScore: null,
    healthLabel: null,
    healthDetail: null,
    heroSummaryText: null,
    heroHighlights: null,
    heroTrend: null,
    heroSummaryLabel: null,
    heroScoreTrend: null,
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
    modalScaleBar: null,
    modalScaleMarker: null,
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
    insightsSection: null,
    insightsGrid: null,
    circadianScaleLux: null,
    circadianScaleCct: null,
    circadianScaleLuxCaption: null,
    circadianScaleCctCaption: null,
    circadianScaleLuxValue: null,
    circadianScaleCctValue: null,
    circadianModalCloseButtons: []
  };

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    registerServiceWorker();
    setupInstallPrompt();
    setupNotifications();
    updateOfflineState();
    const debouncedOfflineUpdate = debounce(updateOfflineState, 150);
    window.addEventListener('online', debouncedOfflineUpdate);
    window.addEventListener('offline', debouncedOfflineUpdate);
    refreshAll(true).catch(handleError);
    setupTimers();
    const scheduleVisibilityRefresh = debounce(() => {
      refreshAll(false).catch(handleError);
    }, 160);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleVisibilityRefresh();
      }
    });
    document.addEventListener('keydown', handleGlobalKeydown);
  });

  function cacheElements() {
    ui.lastUpdated = document.getElementById('last-updated');
    ui.healthScore = document.getElementById('health-score');
    ui.healthLabel = document.getElementById('health-label');
    ui.healthDetail = document.getElementById('health-detail');
    ui.heroSummaryText = document.getElementById('hero-summary-text');
    ui.heroHighlights = document.getElementById('hero-highlights');
    ui.heroTrend = document.getElementById('hero-trend');
    ui.heroSummaryLabel = document.getElementById('hero-summary-label');
    ui.heroScoreTrend = document.getElementById('hero-score-trend');
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
    ui.insightsSection = document.querySelector('.insights-section');
    ui.insightsGrid = document.querySelector('#insights-grid, [data-insights-grid]');
    ui.insightsToggle = document.getElementById('insights-toggle');
    ui.installBtn = document.getElementById('install-btn');
    ui.notifyBtn = document.getElementById('notify-btn');
    ui.pwaStatusBadge = document.getElementById('pwa-status-badge');

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

    if (ui.insightsToggle) {
      ui.insightsToggle.addEventListener('click', () => {
        INSIGHT_STATE.expanded = !INSIGHT_STATE.expanded;
        renderInsights();
      });
    }

    const coreCards = document.querySelectorAll('.core-card');
    coreCards.forEach((card) => {
      const metric = card.getAttribute('data-metric');
      if (!metric) return;
      ui.coreCards.set(metric, card);
      ui.sparklineCards.set(metric, card);
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
    ui.modalScaleBar = document.getElementById('chart-modal-scale-bar');
    ui.modalScaleMarker = document.getElementById('chart-modal-scale-marker');
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
        modalConfig.set({ rangeKey });
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

    setupSwipeToClose(ui.modalContent, closeChartModal);

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
    ui.circadianScaleLux = document.getElementById('circadian-scale-lux');
    ui.circadianScaleCct = document.getElementById('circadian-scale-cct');
    ui.circadianScaleLuxCaption = document.getElementById('circadian-scale-lux-caption');
    ui.circadianScaleCctCaption = document.getElementById('circadian-scale-cct-caption');
    ui.circadianScaleLuxValue = document.getElementById('circadian-scale-lux-value');
    ui.circadianScaleCctValue = document.getElementById('circadian-scale-cct-value');
    ui.circadianModalCloseButtons = Array.from(
      ui.circadianModal?.querySelectorAll('[data-close="true"]') || []
    );
    ui.circadianModalCloseButtons.forEach((button) => {
      button.addEventListener('click', closeCircadianModal);
    });
    setupSwipeToClose(ui.circadianModalContent, closeCircadianModal);
    if (ui.circadianModal) {
      ui.circadianModal.addEventListener('click', (event) => {
        if (event.target?.dataset?.close === 'true') {
          closeCircadianModal();
        }
      });
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

  function setupSwipeToClose(element, onClose) {
    if (!element || typeof onClose !== 'function') return;
    let startY = 0;
    let pointerId = null;
    let tracking = false;

    const resetTransform = () => {
      element.style.transition = '';
      element.style.transform = '';
    };

    const handlePointerDown = (event) => {
      if (event.pointerType === 'mouse') return;
      if (window.innerWidth >= SWIPE_CLOSE_MAX_WIDTH) return;
      if (element.scrollTop > 0) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      tracking = true;
      element.setPointerCapture?.(pointerId);
      element.style.transition = '';
    };

    const handlePointerMove = (event) => {
      if (!tracking || event.pointerId !== pointerId) return;
      const deltaY = event.clientY - startY;
      if (deltaY <= 0) {
        element.style.transform = '';
        return;
      }
      const damped = Math.min(deltaY, SWIPE_CLOSE_THRESHOLD * 1.6) * 0.35;
      element.style.transform = `translateY(${damped}px)`;
    };

    const endGesture = (event) => {
      if (!tracking || (event.pointerId != null && event.pointerId !== pointerId)) return;
      const deltaY = (event.clientY ?? startY) - startY;
      const currentPointerId = pointerId;
      tracking = false;
      pointerId = null;
      if (currentPointerId != null) {
        element.releasePointerCapture?.(currentPointerId);
      }
      element.style.transition = 'transform 180ms ease';
      if (deltaY > SWIPE_CLOSE_THRESHOLD && element.scrollTop <= 0) {
        element.style.transform = '';
        onClose();
      } else {
        element.style.transform = '';
        window.setTimeout(() => {
          element.style.transition = '';
        }, 190);
      }
    };

    const cancelGesture = () => {
      tracking = false;
      pointerId = null;
      resetTransform();
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', endGesture);
    element.addEventListener('pointercancel', cancelGesture);
    element.addEventListener('scroll', () => {
      if (!tracking && element.scrollTop > 2 && element.style.transform) {
        resetTransform();
      }
    });
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
    const headerRect = ui.modalHeader.getBoundingClientRect();
    const headerHeight = headerRect?.height || 0;
    const offset = Math.max(Math.round(headerHeight + 10), 40);
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
    const canvas = card.querySelector('.mini-chart canvas, .core-spark canvas');
    if (!canvas) return;
    const definition = getDefinitionForMetric(metric);
    if (!definition) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const color = definition.colors?.[0] || '#0ea5e9';
    const existing = state.sparklines.get(metric);
    if (existing) {
      try {
        existing.destroy();
      } catch (error) {
        console.warn('Sparkline konnte nicht bereinigt werden', error);
      }
    }
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            data: [],
            borderColor: color,
            backgroundColor: colorWithAlpha(color, 0.1),
            tension: 0.32,
            fill: 'start',
            pointRadius: 0,
            borderWidth: Chart.defaults.elements.line.borderWidth,
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

  function renderTrendCards() {
    const grid = document.querySelector('[data-trend-grid]');
    if (!grid) return;
    grid.innerHTML = '';
    TREND_METRICS.forEach((metric) => {
      const config = METRIC_CONFIG[metric];
      const card = document.createElement('article');
      card.className = 'trend-card mini-card skeleton';
      card.setAttribute('data-metric', metric);
      const icon = METRIC_ICONS[metric] || 'icon-dots';
      const label = config?.label || metric;
      const unit = config?.unit || '';
      card.innerHTML = `
        <span class="mini-icon" aria-hidden="true"><svg><use href="#${icon}" /></svg></span>
        <div class="mini-meta">
          <h3>${label}</h3>
          <p class="mini-value">—</p>
          <span class="mini-unit">${unit}</span>
        </div>
        <div class="mini-chart" aria-hidden="true">
          <canvas></canvas>
        </div>
      `;
      grid.appendChild(card);
      ui.sparklineCards.set(metric, card);
      createSparkline(metric, card);
      setupCardModalTrigger(card, metric);
    });
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
    try {
      const response = await fetch('/api/now', { headers: { 'Accept': 'application/json' } });
      if (!response.ok) {
        let payload = null;
        try {
          payload = await response.clone().json();
        } catch (error) {
          payload = null;
        }
        if (payload?.error === 'backend_unreachable') {
          const err = new Error('Backend nicht erreichbar. Bitte erneut laden.');
          err.code = 'backend_unreachable';
          throw err;
        }
        throw new Error(payload?.error || 'Fehler beim Laden der Live-Daten');
      }
      const payload = await response.json();
      if (!payload || !payload.ok) {
        if (payload?.error === 'backend_unreachable') {
          const err = new Error('Backend nicht erreichbar. Bitte erneut laden.');
          err.code = 'backend_unreachable';
          throw err;
        }
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
      refreshInsights();
    } catch (error) {
      console.error('Live-Daten konnten nicht geladen werden', error);
      throw error;
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
    const metrics = KEY_METRICS;
    const statuses = {};

    metrics.forEach((metric) => {
      const card = ui.coreCards.get(metric);
      const sample = data[metric];
      const config = METRIC_CONFIG[metric];
      if (!card || !config) return;
      const valueEl = card.querySelector('.core-number');
      const badge = card.querySelector('.core-badge');
      if (!sample || !isFinite(sample.value)) {
        if (valueEl) valueEl.textContent = '—';
        if (badge) badge.textContent = 'Keine Daten';
        card.dataset.tone = 'neutral';
        card.classList.add('ready');
        return;
      }
      const status = determineStatus(metric, sample.value);
      statuses[metric] = status;
      if (valueEl) valueEl.textContent = formatNumber(sample.value, config.decimals);
      if (badge) {
        badge.textContent = status.label;
        badge.dataset.tone = status.tone || status.intent || 'neutral';
      }
      card.dataset.tone = status.intent || status.tone || 'neutral';
      card.classList.add('ready');
    });

    const pmSample = data['PM2.5'];
    if (pmSample && isFinite(pmSample.value)) {
      statuses['PM2.5'] = determineStatus('PM2.5', pmSample.value);
    }

    updateHealthCard(statuses);
  }

  function classifyTemperature(v) {
    if (v < 18) return { status: 'Kühl', color: 'red' };
    if (v < 20) return { status: 'Kühl', color: 'yellow' };
    if (v <= 24) return { status: 'Ideal', color: 'green' };
    if (v <= 26) return { status: 'Warm', color: 'yellow' };
    return { status: 'Heiß', color: 'red' };
  }

  function classifyHumidity(v) {
    if (v < 35) return { status: 'Trocken', color: 'red' };
    if (v < 40) return { status: 'Trocken', color: 'yellow' };
    if (v <= 55) return { status: 'Ideal', color: 'green' };
    if (v <= 60) return { status: 'Feucht', color: 'blue' };
    if (v <= 70) return { status: 'Feucht', color: 'yellow' };
    return { status: 'Sehr feucht', color: 'red' };
  }

  function classifyCO2(v) {
    if (v < 800) return { status: 'Hervorragend', color: 'green' };
    if (v < 1000) return { status: 'Gut', color: 'blue' };
    if (v < 1400) return { status: 'Erhöht', color: 'yellow' };
    return { status: 'Schlecht', color: 'red' };
  }

  function classifyTVOC(v) {
    if (v < 150) return { status: 'Hervorragend', color: 'green' };
    if (v < 300) return { status: 'Gut', color: 'blue' };
    if (v < 600) return { status: 'Erhöht', color: 'yellow' };
    return { status: 'Schlecht', color: 'red' };
  }

  const CLASSIFICATION_TONE_MAP = {
    green: 'excellent',
    yellow: 'warning',
    orange: 'warning',
    red: 'poor',
    blue: 'good'
  };

  function statusFromClassification(classification, note = '', tip = '') {
    if (!classification) {
      return buildStatus('neutral', note, tip);
    }
    const tone = CLASSIFICATION_TONE_MAP[classification.color] || 'neutral';
    return {
      intent: tone,
      tone,
      label: classification.status,
      note,
      tip
    };
  }

  function determineStatus(metric, value) {
    if (!isFinite(value)) {
      return { tone: 'neutral', intent: 'neutral', label: 'n/v', note: '', tip: '' };
    }

    switch (metric) {
      case 'CO2': {
        const cls = classifyCO2(value);
        let note = 'Luft sehr frisch.';
        let tip = 'Kein Handlungsbedarf.';
        if (cls.status === 'Gut') {
          note = 'CO₂ gut – alles im Rahmen.';
          tip = 'Gelegentlich stoßlüften.';
        } else if (cls.status === 'Erhöht') {
          note = 'CO₂ erhöht – Konzentration sinkt.';
          tip = 'Jetzt querlüften.';
        } else if (cls.status === 'Schlecht') {
          note = 'Sehr hohe CO₂-Belastung.';
          tip = 'Fenster öffnen oder Lüftung aktivieren.';
        }
        return statusFromClassification(cls, note, tip);
      }
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
      case 'TVOC': {
        const cls = classifyTVOC(value);
        let note = 'VOC-Belastung sehr niedrig.';
        let tip = 'Keine Aktion erforderlich.';
        if (cls.status === 'Gut') {
          note = 'VOC-Bereich unauffällig.';
          tip = 'Regelmäßig kurz lüften.';
        } else if (cls.status === 'Erhöht') {
          note = 'Flüchtige Stoffe nehmen zu.';
          tip = 'Quellen prüfen und lüften.';
        } else if (cls.status === 'Schlecht') {
          note = 'Hohe VOC-Belastung.';
          tip = 'Lüften und Auslöser reduzieren.';
        }
        return statusFromClassification(cls, note, tip);
      }
      case 'Temperatur': {
        if (value < 18) {
          return buildStatus('poor', 'Zu kühl – ggf. Heizung anpassen.', 'Heizung anpassen, Zugluft vermeiden.', 'Kühl');
        }
        if (value < 20) {
          return buildStatus('elevated', 'Kühl.', 'Sanft aufheizen bis in den Komfortbereich.', 'Kühl');
        }
        if (value <= 23) {
          return buildStatus('excellent', 'Im Wohlfühlbereich.', 'Temperatur beibehalten.', 'Ideal');
        }
        if (value <= 25) {
          return buildStatus('good', 'Leicht warm.', 'Kurz lüften oder beschatten.', 'Warm');
        }
        return buildStatus('poor', 'Sehr warm – ggf. kühlen bzw. lüften.', 'Beschattung oder aktive Kühlung nutzen.', 'Heiß');
      }
      case 'rel. Feuchte': {
        if (value < 30) {
          return buildStatus('poor', 'Sehr trockene Luft – befeuchten.', 'Luftbefeuchter oder Pflanzen nutzen.', 'Trocken');
        }
        if (value < 40) {
          return buildStatus('elevated', 'Trockene Luft.', 'Sanft befeuchten oder kürzer lüften.', 'Trocken');
        }
        if (value <= 60) {
          return buildStatus('excellent', 'Wohlfühlbereich.', 'Aktuelles Verhalten passt.', 'Ideal');
        }
        if (value <= 70) {
          return buildStatus('elevated', 'Etwas feuchte Luft.', 'Regelmäßig stoßlüften und trocknen.', 'Feucht');
        }
        return buildStatus('poor', 'Sehr feuchte Luft – Schimmelgefahr.', 'Entfeuchter einsetzen und konsequent lüften.', 'Sehr feucht');
      }
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
      case 'Luftdruck': {
        if (value < 980) {
          return buildStatus('elevated', 'Tiefdruck – Wetterwechsel wahrscheinlich.', 'Kreislauf im Blick behalten.', 'Tiefdruck');
        }
        if (value <= 1005) {
          return buildStatus('excellent', 'Stabiler Druck.', 'Keine Aktion nötig.', 'Stabil');
        }
        if (value <= 1030) {
          return buildStatus('good', 'Hochdruck, trockene Luft.', 'Nach Gefühl lüften.', 'Hochdruck');
        }
        return buildStatus('excellent', 'Sehr hoher Druck, stabil.', 'Nur beobachten.', 'Hochdruck');
      }
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

  function buildStatus(intent, note, tip, labelOverride) {
    const tone = intent || 'neutral';
    return {
      intent: tone,
      tone,
      label: labelOverride || STATUS_LABELS[tone] || STATUS_LABELS.neutral,
      note,
      tip
    };
  }

  function updateHealthCard(statuses) {
    if (!ui.healthScore || !ui.healthLabel || !ui.healthDetail || !ui.healthProgress) return;
    const score = computeHealthScore();
    const tone = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'elevated' : 'poor';
    const label = score >= 80 ? 'Hervorragend' : score >= 60 ? 'Gut' : score >= 40 ? 'Mittel' : 'Schlecht';
    ui.healthScore.textContent = String(score);
    ui.healthLabel.textContent = label;
    ui.healthLabel.style.color = toneToColor(tone);

    const detail = ['CO2', 'PM2.5', 'TVOC', 'rel. Feuchte']
      .filter((metric) => statuses[metric])
      .map((metric) => `${metricLabel(metric)} ${statuses[metric].label}`)
      .join(' • ');
    const placeholder = 'Aktuelle Luftqualität basierend auf CO₂, TVOC, Temperatur und Luftfeuchtigkeit.';
    const heroDetail = INSIGHT_STATE.heroSummary?.text;
    ui.healthDetail.textContent = heroDetail || detail || placeholder;

    const dashoffset = CIRCUMFERENCE * (1 - score / 100);
    ui.healthProgress.setAttribute('stroke-dashoffset', dashoffset.toFixed(2));
    ui.healthProgress.style.stroke = tone === 'excellent' ? 'url(#health-gradient)' : toneToColor(tone);
  }

  function updateHeroOverview(statuses) {
    const summary = INSIGHT_STATE.heroSummary;
    const tone = summary?.tone || 'neutral';
    const highlights = buildHeroHighlights(statuses, INSIGHT_STATE.insights);
    const summaryText = summary?.text || ui.healthDetail?.textContent || '';
    if (ui.heroSummaryText) {
      ui.heroSummaryText.textContent = summaryText || 'Aktuelle Einschätzung folgt, sobald Daten da sind.';
    }
    if (ui.heroSummaryLabel) {
      ui.heroSummaryLabel.textContent = STATUS_LABELS[tone] || 'Aktuell';
      ui.heroSummaryLabel.dataset.tone = tone;
    }
    const trend = computeTrend('CO2');
    const trendText = `${trend?.symbol || '→'} ${trendLabelFromSymbol(trend?.symbol)}`.trim();
    if (ui.heroTrend) ui.heroTrend.textContent = trendText;
    if (ui.heroScoreTrend) ui.heroScoreTrend.textContent = trendText;
    if (ui.heroHighlights) {
      ui.heroHighlights.innerHTML = '';
      const list = highlights.length ? highlights : ['Insights folgen, sobald Daten eintreffen.'];
      list.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        ui.heroHighlights.appendChild(li);
      });
    }
  }

  function trendLabelFromSymbol(symbol) {
    switch (symbol) {
      case '↑':
        return 'steigend';
      case '↓':
        return 'fallend';
      default:
        return 'stabil';
    }
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
        if (value >= 40 && value <= 60) return 100;
        if ((value >= 30 && value < 40) || (value > 60 && value <= 70)) return 70;
        if ((value >= 25 && value < 30) || (value > 70 && value <= 75)) return 45;
        return 20;
      }
      default:
        return 50;
    }
  }

  const INSIGHT_METRICS = ['CO2', 'PM2.5', 'PM1.0', 'PM10', 'TVOC', 'Temperatur', 'rel. Feuchte', 'Lux', 'Farbtemperatur'];

  const SHORT_TERM_WINDOW_MIN_MS = 60 * 60 * 1000;
  const SHORT_TERM_WINDOW_MAX_MS = 120 * 60 * 1000;
  const TIME_OF_DAY_WINDOWS = [
    { key: 'morning', label: 'Morgen', from: 6, to: 11 },
    { key: 'midday', label: 'Tag', from: 11, to: 17 },
    { key: 'evening', label: 'Abend', from: 17, to: 22 },
    { key: 'late_evening', label: 'Später Abend', from: 22, to: 1 }
  ];

  const INSIGHT_STATE = {
    context: null,
    insights: [],
    heroSummary: null,
    expanded: false
  };

  async function getSeriesForMetric(metric, rangeKey) {
    const key = rangeKey in TIME_RANGES ? rangeKey : '24h';
    const range = TIME_RANGES[key];
    const chartKey = METRIC_TO_CHART_KEY[metric];
    if (!chartKey || !range) return [];
    const definition = CHART_DEFINITIONS[chartKey];
    if (!definition) return [];
    const cacheKey = `${definition.key}_${range.range}`;
    let cached = state.chartDataCache.get(cacheKey);
    if (!cached) {
      try {
        cached = await ensureSeries(definition, range, false);
      } catch (error) {
        console.warn('Serie konnte nicht geladen werden', metric, key, error);
        return [];
      }
    }
    const series = cached?.[metric];
    if (!Array.isArray(series)) return [];
    return series
      .map((point) => ({ ts: Number(point?.x), value: Number(point?.y) }))
      .filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.value));
  }

  function buildSeriesStats(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        avg: null,
        latest: null,
        earliest: null,
        trendSlope: null,
        trendDirection: 'flat',
        durationMs: 0
      };
    }
    const sorted = points.slice().sort((a, b) => a.ts - b.ts);
    const values = sorted.map((p) => p.value).filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        avg: null,
        latest: null,
        earliest: null,
        trendSlope: null,
        trendDirection: 'flat',
        durationMs: 0
      };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = sum / values.length;
    const earliest = sorted[0].value;
    const latest = sorted[sorted.length - 1].value;
    const durationMs = Math.max(0, sorted[sorted.length - 1].ts - sorted[0].ts);
    const trendSlope = durationMs > 0 ? (latest - earliest) / durationMs : 0;
    const tolerance = Math.max(0.05, Math.min(0.1, Math.abs(earliest || latest) * 0.0001));
    const relativeChange = earliest ? (latest - earliest) / Math.max(Math.abs(earliest), 1) : 0;
    let trendDirection = 'flat';
    if (relativeChange > tolerance) trendDirection = 'rising';
    else if (relativeChange < -tolerance) trendDirection = 'falling';
    return {
      count: values.length,
      min,
      max,
      avg,
      latest,
      earliest,
      trendSlope,
      trendDirection,
      durationMs
    };
  }

  function normalizeBands(metric) {
    const insightScale = METRIC_INSIGHTS[metric]?.scale;
    const preset = VALUE_SCALE_PRESETS[metric];
    if (insightScale?.bands) return insightScale.bands;
    if (insightScale?.stops) {
      return insightScale.stops.map((stop, index, arr) => ({
        label: stop.label,
        tone: stop.tone,
        min: index === 0 ? Number.NEGATIVE_INFINITY : arr[index - 1].value,
        max: stop.value
      }));
    }
    if (preset?.segments) return preset.segments;
    if (preset?.stops) {
      return preset.stops.map((stop, index, arr) => ({
        label: stop.label,
        tone: stop.tone,
        min: index === 0 ? Number.NEGATIVE_INFINITY : arr[index - 1].value,
        max: stop.value
      }));
    }
    return null;
  }

  function classifyValueWithScale(metric, value) {
    if (!Number.isFinite(value)) {
      return { tone: 'neutral', bandLabel: null, bandIndex: -1 };
    }
    const bands = normalizeBands(metric);
    if (!Array.isArray(bands)) {
      return { tone: 'neutral', bandLabel: null, bandIndex: -1 };
    }
    for (let index = 0; index < bands.length; index++) {
      const band = bands[index];
      if (band == null) continue;
      const min = Number.isFinite(band.min) ? band.min : Number.NEGATIVE_INFINITY;
      const max = Number.isFinite(band.max) ? band.max : Number.POSITIVE_INFINITY;
      const stopValue = band.value ?? max;
      const upper = Number.isFinite(stopValue) ? stopValue : max;
      if (value >= min && value < upper) {
        return {
          tone: band.tone || 'neutral',
          bandLabel: band.label || null,
          bandIndex: index
        };
      }
    }
    const last = bands[bands.length - 1];
    return {
      tone: last?.tone || 'neutral',
      bandLabel: last?.label || null,
      bandIndex: bands.length - 1
    };
  }

  function computeShareOutsideGood(metric, points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let totalMs = 0;
    let outsideMs = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      if (!current || !next) continue;
      const span = Math.max(0, next.ts - current.ts);
      totalMs += span;
      const tone = classifyValueWithScale(metric, current.value)?.tone;
      if (tone !== 'excellent' && tone !== 'good') {
        outsideMs += span;
      }
    }
    if (totalMs === 0) return 0;
    return clamp(outsideMs / totalMs, 0, 1);
  }

  function computeMaxStreakOutsideGood(metric, points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let longest = 0;
    let current = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const now = points[i];
      const next = points[i + 1];
      if (!now || !next) continue;
      const span = Math.max(0, next.ts - now.ts);
      const tone = classifyValueWithScale(metric, now.value)?.tone;
      if (tone !== 'excellent' && tone !== 'good') {
        current += span;
      } else {
        longest = Math.max(longest, current);
        current = 0;
      }
    }
    longest = Math.max(longest, current);
    return Math.round((longest / (1000 * 60 * 60)) * 10) / 10;
  }

  function computeShortTermTrend(metric, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const sorted = points.slice().sort((a, b) => a.ts - b.ts);
    const latest = sorted[sorted.length - 1];
    if (!latest) return null;
    const targetTs = latest.ts - (SHORT_TERM_WINDOW_MIN_MS + SHORT_TERM_WINDOW_MAX_MS) / 2;
    let reference = null;
    for (let index = sorted.length - 2; index >= 0; index--) {
      const candidate = sorted[index];
      if (!candidate) continue;
      const deltaMs = latest.ts - candidate.ts;
      if (deltaMs >= SHORT_TERM_WINDOW_MIN_MS && deltaMs <= SHORT_TERM_WINDOW_MAX_MS) {
        if (!reference || Math.abs(candidate.ts - targetTs) < Math.abs(reference.ts - targetTs)) {
          reference = candidate;
        }
      } else if (deltaMs > SHORT_TERM_WINDOW_MAX_MS && reference) {
        break;
      }
    }
    if (!reference) return null;
    const delta = latest.value - reference.value;
    const hours = Math.max((latest.ts - reference.ts) / 3600000, 0.5);
    const rate = delta / hours;
    const thresholds = {
      CO2: { slow: 30, fast: 100 },
      'PM2.5': { slow: 2, fast: 6 },
      PM10: { slow: 4, fast: 10 },
      TVOC: { slow: 40, fast: 140 },
      Temperatur: { slow: 0.3, fast: 0.9 },
      'rel. Feuchte': { slow: 1.5, fast: 4 },
      Lux: { slow: 50, fast: 180 },
      Farbtemperatur: { slow: 80, fast: 220 }
    };
    const { slow, fast } = thresholds[metric] || { slow: 0.5, fast: 1.5 };
    let classification = 'stable';
    if (rate > fast) classification = 'rising_fast';
    else if (rate > slow) classification = 'rising_slow';
    else if (rate < -fast) classification = 'falling_fast';
    else if (rate < -slow) classification = 'falling_slow';
    return {
      delta,
      ratePerHour: rate,
      sinceMinutes: Math.round((latest.ts - reference.ts) / 60000),
      classification
    };
  }

  function computeVolatility(metric, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const values = points.map((p) => p?.value).filter((v) => Number.isFinite(v));
    if (values.length < 2) return null;
    const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const variabilityIndex = avg ? std / Math.max(Math.abs(avg), 1) : std;
    const thresholds = {
      CO2: { low: 0.08, high: 0.25 },
      'PM2.5': { low: 0.2, high: 0.6 },
      PM10: { low: 0.2, high: 0.6 },
      TVOC: { low: 0.15, high: 0.45 },
      Temperatur: { low: 0.015, high: 0.05 },
      'rel. Feuchte': { low: 0.04, high: 0.12 },
      Lux: { low: 0.25, high: 0.8 },
      Farbtemperatur: { low: 0.05, high: 0.12 }
    };
    const { low, high } = thresholds[metric] || { low: 0.1, high: 0.3 };
    const level = variabilityIndex < low ? 'low' : variabilityIndex < high ? 'medium' : 'high';
    return { std, variabilityIndex, level, avg };
  }

  function determineElevationType(metric, points, tone) {
    if (!Array.isArray(points) || points.length < 2) return 'normal';
    if (!['elevated', 'warning', 'poor', 'critical'].includes(tone)) return 'normal';
    const sorted = points.slice().sort((a, b) => a.ts - b.ts);
    const latest = sorted[sorted.length - 1];
    if (!latest) return 'normal';
    const recentFrom = latest.ts - 2 * 3600000;
    const earlierFrom = latest.ts - 6 * 3600000;
    const recent = sorted.filter((p) => p.ts >= recentFrom);
    const earlier = sorted.filter((p) => p.ts >= earlierFrom && p.ts < recentFrom);
    const recentShare = computeShareOutsideGood(metric, recent);
    const earlierShare = computeShareOutsideGood(metric, earlier);
    if (recentShare > 0.6 && earlierShare > 0.35) return 'plateau';
    if (recentShare > 0.35 && earlierShare < 0.25) return 'spike';
    if (recentShare > 0.5) return 'plateau';
    return 'spike';
  }

  function summarizeMonthly(metric, points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    const stats = buildSeriesStats(points);
    const shareOutsideGood = computeShareOutsideGood(metric, points);
    const daily = new Map();
    for (const point of points) {
      if (!point) continue;
      const dayKey = new Date(point.ts).toISOString().slice(0, 10);
      const bucket = daily.get(dayKey) || { sum: 0, count: 0 };
      bucket.sum += point.value;
      bucket.count += 1;
      daily.set(dayKey, bucket);
    }
    let daysWithElevatedOrWorse = 0;
    for (const bucket of daily.values()) {
      if (!bucket.count) continue;
      const avg = bucket.sum / bucket.count;
      const tone = classifyValueWithScale(metric, avg)?.tone;
      if (tone !== 'excellent' && tone !== 'good') {
        daysWithElevatedOrWorse += 1;
      }
    }
    return {
      avg: stats.avg,
      min: stats.min,
      max: stats.max,
      shareOutsideGood,
      shareGood: clamp(1 - shareOutsideGood, 0, 1),
      daysWithElevatedOrWorse
    };
  }

  function deriveRoomProfile(metric, monthly) {
    if (!monthly) return null;
    const share = monthly.shareOutsideGood ?? 0;
    const avg = monthly.avg ?? 0;
    const daysElevated = monthly.daysWithElevatedOrWorse ?? 0;
    switch (metric) {
      case 'CO2':
        if (share > 0.45 || daysElevated >= 15) return 'frequently_high';
        if (share > 0.25 || daysElevated >= 8) return 'often_elevated';
        return 'usually_good';
      case 'rel. Feuchte':
        if (avg <= 38) return 'tends_dry';
        if (avg >= 63) return 'tends_humid';
        return 'balanced';
      case 'PM2.5':
      case 'PM10':
      case 'PM1.0':
        if (share > 0.35 || daysElevated >= 10) return 'frequently_dusty';
        if (share > 0.18 || daysElevated >= 6) return 'occasionally_dusty';
        return 'usually_clean';
      case 'TVOC':
        if (share > 0.4 || daysElevated >= 10) return 'persistent_emissions';
        if (share > 0.2 || daysElevated >= 6) return 'moderate_emissions';
        return 'low_emissions';
      default:
        return null;
    }
  }

  function computeTimeOfDayPatterns(metric, points) {
    if (!Array.isArray(points) || points.length < 8) return null;
    const windows = TIME_OF_DAY_WINDOWS.map((window) => ({ ...window, sum: 0, count: 0, outside: 0 }));
    for (const point of points) {
      if (!point) continue;
      const hour = new Date(point.ts).getHours();
      for (const window of windows) {
        const inRange = window.from <= window.to ? hour >= window.from && hour < window.to : hour >= window.from || hour < window.to;
        if (inRange) {
          window.sum += point.value;
          window.count += 1;
          const tone = classifyValueWithScale(metric, point.value)?.tone;
          if (tone !== 'excellent' && tone !== 'good') {
            window.outside += 1;
          }
          break;
        }
      }
    }
    const stats = {};
    for (const window of windows) {
      const avg = window.count ? window.sum / window.count : null;
      const outsideShare = window.count ? window.outside / window.count : 0;
      stats[window.key] = {
        key: window.key,
        label: window.label,
        avg,
        outsideShare,
        count: window.count,
        from: window.from,
        to: window.to
      };
    }
    const sortedByOutside = Object.values(stats)
      .filter((entry) => entry.count >= 2)
      .sort((a, b) => b.outsideShare - a.outsideShare);
    const dominant = sortedByOutside[0];
    const second = sortedByOutside[1];
    const hasDominant = dominant && dominant.outsideShare >= 0.18 && (!second || dominant.outsideShare - second.outsideShare >= 0.05);
    return {
      windows: stats,
      dominantWindow: hasDominant ? dominant.key : null,
      dominantOutsideShare: hasDominant ? dominant.outsideShare : null
    };
  }

  function computeOptimalHours(metric, points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let insideMs = 0;
    let lastTs = points[0].ts;
    for (let i = 1; i < points.length; i += 1) {
      const current = points[i];
      const prev = points[i - 1];
      if (!current || !prev) continue;
      const tone = classifyValueWithScale(metric, prev.value)?.tone;
      if (tone === 'excellent' || tone === 'good') {
        insideMs += Math.max(0, current.ts - lastTs);
      }
      lastTs = current.ts;
    }
    return Math.max(0, insideMs / 3600000);
  }

  function computeCo2ExposureScore(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    const weighted = points
      .map((point) => {
        if (!point) return null;
        const value = clamp(point.value, 400, 2000);
        const penalty = Math.pow((value - 400) / 1600, 1.35);
        return 100 - penalty * 100;
      })
      .filter((value) => Number.isFinite(value));
    if (!weighted.length) return null;
    const avg = weighted.reduce((sum, value) => sum + value, 0) / weighted.length;
    return clamp(Math.round(avg), 0, 100);
  }

  function computePeakLoad(points, threshold = 1400) {
    if (!Array.isArray(points) || points.length < 2) return { count: 0, totalMinutes: 0 };
    let active = false;
    let startTs = 0;
    let count = 0;
    let totalMs = 0;
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      if (!point) continue;
      const above = point.value >= threshold;
      if (above && !active) {
        active = true;
        startTs = point.ts;
        count += 1;
      }
      if ((!above || i === points.length - 1) && active) {
        const endTs = point.ts;
        totalMs += Math.max(0, endTs - startTs);
        active = false;
      }
    }
    return { count, totalMinutes: Math.round(totalMs / 60000) };
  }

  function computeBreathFootprint(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const slopes = [];
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      if (!prev || !curr) continue;
      const dtMin = Math.max(0.01, (curr.ts - prev.ts) / 60000);
      const rise = curr.value - prev.value;
      const slope = rise / dtMin;
      if (slope > 10) {
        slopes.push(slope);
      }
    }
    if (!slopes.length) return null;
    const median = slopes.sort((a, b) => a - b)[Math.floor(slopes.length / 2)];
    return { ppmPerMinute: Math.round(median), label: median > 35 ? 'hohe Belegung' : 'moderate Belegung' };
  }

  function computeVentEffectiveness(points) {
    if (!Array.isArray(points) || points.length < 4) return null;
    let bestDrop = 0;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      if (!prev || !curr) continue;
      const dtMin = Math.max(0.01, (curr.ts - prev.ts) / 60000);
      const slope = (curr.value - prev.value) / dtMin;
      if (slope < bestDrop) {
        bestDrop = slope;
      }
    }
    if (bestDrop === 0) return null;
    return { ppmPerMinute: Math.abs(Math.round(bestDrop)), label: bestDrop < -80 ? 'sehr effektiv' : bestDrop < -40 ? 'effektiv' : 'verhalten' };
  }

  function computeTvocSources(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    let rapidPeaks = 0;
    let lingering = 0;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      if (!prev || !curr) continue;
      const dtMin = Math.max(0.01, (curr.ts - prev.ts) / 60000);
      const delta = curr.value - prev.value;
      if (delta > 120 && dtMin <= 15) {
        rapidPeaks += 1;
      }
      if (delta < -30 && dtMin >= 5) {
        lingering += 1;
      }
    }
    return {
      rapidPeaks,
      lingering,
      suggestion: rapidPeaks >= 2 ? 'wahrscheinlich Reinigungsmittel / Küche – Quelle prüfen' : 'langsamer Abbau, Quelle wohl inaktiv'
    };
  }

  function summarizeWeekly(metric, points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    const stats = buildSeriesStats(points);
    const daily = new Map();
    for (const point of points) {
      if (!point) continue;
      const dayKey = new Date(point.ts).toISOString().slice(0, 10);
      const bucket = daily.get(dayKey) || { sum: 0, count: 0 };
      bucket.sum += point.value;
      bucket.count += 1;
      daily.set(dayKey, bucket);
    }
    let daysWithElevatedOrWorse = 0;
    for (const bucket of daily.values()) {
      if (!bucket.count) continue;
      const avg = bucket.sum / bucket.count;
      const tone = classifyValueWithScale(metric, avg)?.tone;
      if (tone !== 'excellent' && tone !== 'good') {
        daysWithElevatedOrWorse += 1;
      }
    }
    return {
      avg: stats.avg,
      min: stats.min,
      max: stats.max,
      daysWithElevatedOrWorse
    };
  }

  async function buildInsightContext() {
    const phase = resolveCircadianPhase();
    const metricContexts = [];
    const roomProfile = {};
    const timeOfDayPatterns = {};
    for (const metric of INSIGHT_METRICS) {
      const nowValue = state.now?.[metric]?.value;
      const nowStatus = Number.isFinite(nowValue) ? determineStatus(metric, nowValue) : null;
      const nowClassification = classifyValueWithScale(metric, nowValue);
      let stats24h = null;
      let stats7d = null;
      let stats30d = null;
      let shortTermTrend = null;
      let volatility = null;
      let elevationType = 'normal';
      let optimalHours = 0;
      let exposureScore = null;
      let peakLoad = null;
      let breathFootprint = null;
      let ventEffectiveness = null;
      let tvocSources = null;
      try {
        const series24 = await getSeriesForMetric(metric, '24h');
        if (Array.isArray(series24) && series24.length) {
          const s = buildSeriesStats(series24);
          stats24h = {
            ...s,
            shareOutsideGood: computeShareOutsideGood(metric, series24),
            maxStreakOutsideGoodHours: computeMaxStreakOutsideGood(metric, series24)
          };
          shortTermTrend = computeShortTermTrend(metric, series24);
          volatility = computeVolatility(metric, series24);
          elevationType = determineElevationType(metric, series24, nowClassification.tone);
          optimalHours = computeOptimalHours(metric, series24);
          if (metric === 'CO2') {
            exposureScore = computeCo2ExposureScore(series24);
            peakLoad = computePeakLoad(series24);
            breathFootprint = computeBreathFootprint(series24);
            ventEffectiveness = computeVentEffectiveness(series24);
          }
          if (metric === 'TVOC') {
            tvocSources = computeTvocSources(series24);
          }
        }
      } catch (error) {
        console.warn('24h Statistik fehlgeschlagen', metric, error);
      }
      try {
        const series7d = await getSeriesForMetric(metric, '7d');
        if (Array.isArray(series7d) && series7d.length) {
          stats7d = summarizeWeekly(metric, series7d);
          timeOfDayPatterns[metric] = computeTimeOfDayPatterns(metric, series7d);
        }
      } catch (error) {
        console.warn('7d Statistik fehlgeschlagen', metric, error);
      }
      try {
        const series30d = await getSeriesForMetric(metric, '30d');
        if (Array.isArray(series30d) && series30d.length) {
          stats30d = summarizeMonthly(metric, series30d);
          timeOfDayPatterns[metric] = timeOfDayPatterns[metric] || computeTimeOfDayPatterns(metric, series30d);
          const profile = deriveRoomProfile(metric, stats30d);
          if (profile) {
            roomProfile[metric] = profile;
          }
        }
      } catch (error) {
        console.warn('30d Statistik fehlgeschlagen', metric, error);
      }
      const entry = {
        metric,
        now: {
          value: Number.isFinite(nowValue) ? nowValue : null,
          status: nowStatus,
          tone: nowStatus?.tone || nowStatus?.intent || nowClassification.tone,
          bandLabel: nowClassification.bandLabel || nowStatus?.label || null
        },
        stats24h,
        stats7d,
        stats30d,
        shortTermTrend,
        volatility,
        elevationType,
        optimalHours,
        exposureScore,
        peakLoad,
        breathFootprint,
        ventEffectiveness,
        tvocSources
      };
      metricContexts.push(entry);
    }

    const context = {
      metrics: metricContexts,
      timestamp: Date.now(),
      phase,
      roomProfile,
      patterns: timeOfDayPatterns,
      circadian:
        state.now && (state.now['Farbtemperatur'] || state.now.Lux)
          ? evaluateCircadian(state.now['Farbtemperatur']?.value, state.now.Lux?.value, phase)
          : null
    };
    return context;
  }

  function getMetricContext(context, metric) {
    if (!context?.metrics) return null;
    return context.metrics.find((entry) => entry.metric === metric) || null;
  }

  const INSIGHT_RULES = [
    {
      id: 'co2_persistent_high',
      metric: 'CO2',
      severity: 'warning',
      group: 'profile',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return (
          co2?.stats24h?.shareOutsideGood >= 0.4 &&
          ['elevated', 'warning', 'poor', 'critical'].includes(co2.now?.tone)
        );
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        if (!co2?.stats24h) return null;
        const hours = Math.max(1, Math.round((co2.stats24h.shareOutsideGood * (co2.stats24h.durationMs / 3600000 || 24))));
        return {
          id: 'co2_persistent_high',
          metric: 'CO2',
          severity: 'warning',
          tone: 'elevated',
          title: 'CO₂ seit Stunden erhöht',
          summary: `CO₂ war in den letzten 24 h über etwa ${hours} Stunden erhöht oder schlecht.`,
          recommendation: 'Regelmäßiger Stoß- und Querlüftung planen und Lüftung länger laufen lassen.',
          tags: ['lüften', 'co2'],
          highlightRange: { from: 1000, to: 2000, unit: 'ppm' }
        };
      }
    },
    {
      id: 'co2_short_peak',
      metric: 'CO2',
      severity: 'info',
      group: 'co2',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return (
          co2?.stats24h &&
          co2.stats24h.shareOutsideGood < 0.25 &&
          Number.isFinite(co2.stats24h.max) &&
          Number.isFinite(co2.now?.value) &&
          co2.stats24h.max > co2.now.value * 1.2
        );
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        if (!co2?.stats24h) return null;
        return {
          id: 'co2_short_peak',
          metric: 'CO2',
          severity: 'info',
          tone: 'good',
          title: 'Kurzer CO₂-Peak',
          summary: 'CO₂ hatte kurzzeitig einen starken Peak, aktuell aber wieder im Rahmen.',
        recommendation: 'Solange das selten bleibt, reicht normales Lüften nach Spitzen.',
        tags: ['lüften', 'co2']
      };
    }
    },
    {
      id: 'co2_rising_now',
      metric: 'CO2',
      severity: 'warning',
      group: 'co2',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return (
          co2?.shortTermTrend?.classification?.startsWith('rising') &&
          ['elevated', 'warning', 'poor', 'critical'].includes(co2?.now?.tone)
        );
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        const direction = co2?.shortTermTrend?.classification === 'rising_fast' ? 'schnell' : 'merklich';
        return {
          id: 'co2_rising_now',
          metric: 'CO2',
          severity: 'warning',
          tone: 'elevated',
          title: 'CO₂ steigt gerade',
          summary: `CO₂ ist erhöht und steigt ${direction} weiter an.`,
          recommendation: 'Jetzt lüften oder Türen öffnen, bevor es stärker ansteigt.',
          tags: ['lüften', 'co2']
        };
      }
    },
    {
      id: 'co2_falling_after_peak',
      metric: 'CO2',
      severity: 'info',
      group: 'co2',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return (
          co2?.shortTermTrend?.classification?.startsWith('falling') &&
          ['elevated', 'warning', 'poor', 'critical'].includes(co2?.now?.tone)
        );
      },
      build: (context) => {
        return {
          id: 'co2_falling_after_peak',
          metric: 'CO2',
          severity: 'info',
          tone: 'good',
          title: 'CO₂ fällt wieder',
          summary: 'Nach einer Spitze sinkt der CO₂-Wert bereits – Lüften zeigt Wirkung.',
          recommendation: 'Kurz weiterlüften, bis der Wert wieder im grünen Bereich liegt.',
          tags: ['lüften', 'co2']
        };
      }
    },
    {
      id: 'co2_multi_day',
      metric: 'CO2',
      severity: 'warning',
      group: 'co2',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return co2?.stats7d?.daysWithElevatedOrWorse >= 3;
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        const days = co2?.stats7d?.daysWithElevatedOrWorse || 0;
        return {
          id: 'co2_multi_day',
          metric: 'CO2',
          severity: 'warning',
          tone: 'elevated',
          title: 'CO₂ mehrfach erhöht',
          summary: `An ${days} von 7 Tagen lag der mittlere CO₂-Wert zu hoch.`,
          recommendation: 'Lüftungsroutinen anpassen oder Frischluftzufuhr dauerhaft erhöhen.',
          tags: ['lüften', 'co2']
        };
      }
    },
    {
      id: 'co2_room_profile',
      metric: 'CO2',
      severity: 'warning',
      group: 'profile',
      when: (context) => {
        const profile = context?.roomProfile?.CO2;
        return profile === 'often_elevated' || profile === 'frequently_high';
      },
      build: () => {
        return {
          id: 'co2_room_profile',
          metric: 'CO2',
          severity: 'warning',
          tone: 'elevated',
          title: 'CO₂ im Raum häufig erhöht',
          summary: 'In den letzten Wochen lag der mittlere CO₂-Wert häufig oberhalb des optimalen Bereichs.',
          recommendation:
            'Lüftungskonzept anpassen (z.B. häufiger Stoßlüften, Türspalt offen lassen, ggf. Lüfter länger laufen lassen).',
          tags: ['lüften', 'co2'],
          group: 'profile'
        };
      }
    },
    {
      id: 'co2_evening_pattern',
      metric: 'CO2',
      severity: 'info',
      group: 'pattern',
      when: (context) => {
        const pattern = context?.patterns?.CO2;
        const evening = pattern?.windows?.evening;
        if (!evening || evening.count < 3) return false;
        const otherWindows = Object.values(pattern.windows || {}).filter((w) => w.key !== 'evening' && w.count >= 2);
        const maxOther = otherWindows.length ? Math.max(...otherWindows.map((w) => w.outsideShare)) : 0;
        return evening.outsideShare >= 0.22 && evening.outsideShare - maxOther >= 0.06;
      },
      build: () => {
        return {
          id: 'co2_evening_pattern',
          metric: 'CO2',
          severity: 'info',
          tone: 'elevated',
          title: 'Abendliche CO₂-Last',
          summary: 'CO₂ steigt vor allem abends an – typischerweise zwischen 17 und 22 Uhr.',
          recommendation: 'Vor oder nach dem Abendessen gezielt stoßlüften, Türen offen lassen, ggf. Lüfter nutzen.',
          tags: ['lüften', 'co2', 'pattern']
        };
      }
    },
    {
      id: 'pm25_consistently_low',
      metric: 'PM2.5',
      severity: 'info',
      group: 'air_quality',
      when: (context) => {
        const pm = getMetricContext(context, 'PM2.5');
        return pm?.stats24h?.shareOutsideGood != null && pm.stats24h.shareOutsideGood < 0.08;
      },
      build: () => ({
        id: 'pm25_consistently_low',
        metric: 'PM2.5',
        severity: 'info',
        tone: 'excellent',
        title: 'Feinstaub dauerhaft niedrig',
        summary: 'Feinstaub blieb durchgehend im grünen Bereich.',
        recommendation: 'Weiter so – Lüftungs- und Reinigungsroutine passt.',
        tags: ['pm', 'sauber']
      })
    },
    {
      id: 'pm1_clean',
      metric: 'PM1.0',
      severity: 'info',
      group: 'air_quality',
      when: (context) => {
        const pm = getMetricContext(context, 'PM1.0');
        return pm?.stats24h?.shareOutsideGood != null && pm.stats24h.shareOutsideGood < 0.12;
      },
      build: () => ({
        id: 'pm1_clean',
        metric: 'PM1.0',
        severity: 'info',
        tone: 'excellent',
        title: 'Sehr feiner Staub unauffällig',
        summary: 'PM1.0 blieb überwiegend hervorragend.',
        recommendation: 'Aktuelle Routine beibehalten, Quellen gering.',
        tags: ['pm']
      })
    },
    {
      id: 'pm1_elevated',
      metric: 'PM1.0',
      severity: 'warning',
      group: 'air_quality',
      when: (context) => {
        const pm = getMetricContext(context, 'PM1.0');
        return pm?.stats24h?.shareOutsideGood > 0.25 && pm?.now?.tone !== 'excellent';
      },
      build: () => ({
        id: 'pm1_elevated',
        metric: 'PM1.0',
        severity: 'warning',
        tone: 'elevated',
        title: 'Feinster Staub erhöht',
        summary: 'PM1.0 war länger erhöht – sehr feine Partikel im Raum.',
        recommendation: 'Innenquellen prüfen, lüften und ggf. Luftreiniger nutzen.',
        tags: ['pm', 'lüften']
      })
    },
    {
      id: 'pm_peaks',
      metric: 'PM2.5',
      severity: 'warning',
      group: 'air_quality',
      when: (context) => {
        const pm = getMetricContext(context, 'PM2.5');
        return (
          pm?.stats24h &&
          pm.stats24h.shareOutsideGood > 0.15 &&
          pm.stats24h.max > (pm.stats24h.avg || 0) * 1.8
        );
      },
      build: () => ({
        id: 'pm_peaks',
        metric: 'PM2.5',
        severity: 'warning',
        tone: 'elevated',
        title: 'Wiederkehrende Feinstaub-Peaks',
        summary: 'Feinstaub zeigt wiederkehrende Spitzen – Innenquellen sind wahrscheinlich.',
        recommendation: 'Abendliche Quellen wie Kochen, Kerzen oder Rauch minimieren und lüften.',
        tags: ['pm', 'lüften']
      })
    },
    {
      id: 'pm_general_elevated',
      metric: 'PM10',
      severity: 'warning',
      group: 'air_quality',
      when: (context) => {
        const pm = getMetricContext(context, 'PM10');
        return pm?.stats24h?.shareOutsideGood > 0.3;
      },
      build: () => ({
        id: 'pm_general_elevated',
        metric: 'PM10',
        severity: 'warning',
        tone: 'elevated',
        title: 'Feinstaub heute erhöht',
        summary: 'Feinstaub war über den Tag hinweg häufig erhöht.',
        recommendation: 'Lüften, Oberflächen reinigen und Staubquellen prüfen.',
        tags: ['pm', 'lüften']
      })
    },
    {
      id: 'pm_recent_spike',
      metric: 'PM2.5',
      severity: 'info',
      group: 'air_quality',
      when: (context) => {
        const pm = getMetricContext(context, 'PM2.5');
        return pm?.elevationType === 'spike' && ['elevated', 'warning', 'poor'].includes(pm?.now?.tone);
      },
      build: () => ({
        id: 'pm_recent_spike',
        metric: 'PM2.5',
        severity: 'info',
        tone: 'elevated',
        title: 'Feinstaub-Peak erkannt',
        summary: 'Aktuell erhöhter Feinstaub deutet auf einen kurzen Peak hin (z.B. Kochen oder Reinigen).',
        recommendation: 'Kurz durchlüften oder Abzug nutzen, danach sollte der Wert zügig sinken.',
        tags: ['pm', 'lüften']
      })
    },
    {
      id: 'tvoc_persistent',
      metric: 'TVOC',
      severity: 'warning',
      group: 'air_quality',
      when: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        return tvoc?.stats24h?.shareOutsideGood > 0.35;
      },
      build: () => ({
        id: 'tvoc_persistent',
        metric: 'TVOC',
        severity: 'warning',
        tone: 'elevated',
        title: 'TVOC dauerhaft erhöht',
        summary: 'Flüchtige organische Verbindungen bleiben länger erhöht.',
        recommendation: 'Quellen prüfen (Reinigungsmittel, Möbel) und öfter lüften.',
        tags: ['tvoc', 'lüften']
      })
    },
    {
      id: 'tvoc_peaks',
      metric: 'TVOC',
      severity: 'info',
      group: 'air_quality',
      when: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        return (
          tvoc?.stats24h?.shareOutsideGood < 0.3 &&
          Number.isFinite(tvoc?.stats24h?.max) &&
          Number.isFinite(tvoc?.stats24h?.avg) &&
          tvoc.stats24h.max > tvoc.stats24h.avg * 2
        );
      },
      build: () => ({
        id: 'tvoc_peaks',
        metric: 'TVOC',
        severity: 'info',
        tone: 'good',
        title: 'TVOC schwankt stark',
        summary: 'Einzelne starke TVOC-Peaks deuten auf kurzzeitige Quellen.',
        recommendation: 'Bei Peaks Lüften und Quellen wie Reiniger oder Sprays reduzieren.',
        tags: ['tvoc', 'lüften']
      })
    },
    {
      id: 'tvoc_short_spike',
      metric: 'TVOC',
      severity: 'info',
      group: 'air_quality',
      when: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        return tvoc?.elevationType === 'spike' && ['elevated', 'warning', 'poor'].includes(tvoc?.now?.tone);
      },
      build: () => ({
        id: 'tvoc_short_spike',
        metric: 'TVOC',
        severity: 'info',
        tone: 'elevated',
        title: 'TVOC-Spitze, kurzzeitig',
        summary: 'Die aktuelle TVOC-Erhöhung sieht nach einem kurzen Peak aus (z.B. Reiniger oder Kochen).',
        recommendation: 'Kurz lüften und die Quelle beenden, danach sinkt der Wert meist schnell.',
        tags: ['tvoc', 'lüften']
      })
    },
    {
      id: 'tvoc_plateau',
      metric: 'TVOC',
      severity: 'warning',
      group: 'air_quality',
      when: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        return tvoc?.elevationType === 'plateau' && ['elevated', 'warning', 'poor'].includes(tvoc?.now?.tone);
      },
      build: () => ({
        id: 'tvoc_plateau',
        metric: 'TVOC',
        severity: 'warning',
        tone: 'elevated',
        title: 'TVOC länger erhöht',
        summary: 'VOC bleiben seit Stunden erhöht – eher ein Plateau als ein kurzer Peak.',
        recommendation: 'Konstant lüften, Quellen prüfen (z.B. neue Möbel, Reiniger) und Raum durchlüften.',
        tags: ['tvoc', 'lüften']
      })
    },
    {
      id: 'evening_cooking_pattern',
      metric: 'TVOC',
      severity: 'info',
      group: 'pattern',
      when: (context) => {
        const pmPattern = context?.patterns?.['PM2.5'];
        const vocPattern = context?.patterns?.TVOC;
        const eveningPm = pmPattern?.windows?.evening;
        const eveningVoc = vocPattern?.windows?.evening;
        if (!eveningPm || !eveningVoc) return false;
        const pmFlag = eveningPm.outsideShare >= 0.18 && eveningPm.count >= 3;
        const vocFlag = eveningVoc.outsideShare >= 0.18 && eveningVoc.count >= 3;
        return pmFlag && vocFlag;
      },
      build: () => ({
        id: 'evening_cooking_pattern',
        metric: 'TVOC',
        severity: 'info',
        tone: 'elevated',
        title: 'Abendliche Peaks durch Aktivitäten',
        summary: 'Feinstaub und VOC steigen vor allem am Abend kurzzeitig an – wahrscheinlich durch Kochen, Kerzen oder Reiniger.',
        recommendation: 'Beim Kochen und Reinigen lüften, Abzug nutzen und Duftquellen begrenzen.',
        tags: ['pattern', 'pm', 'tvoc']
      })
    },
    {
      id: 'localized_pattern_issue',
      metric: null,
      severity: 'info',
      group: 'pattern',
      when: (context) => {
        const metrics = ['CO2', 'PM2.5', 'TVOC'];
        return metrics.some((metric) => {
          const pattern = context?.patterns?.[metric];
          if (!pattern?.dominantWindow) return false;
          const stats = getMetricContext(context, metric)?.stats24h;
          return stats?.shareOutsideGood != null && stats.shareOutsideGood < 0.2;
        });
      },
      build: (context) => {
        const metrics = ['CO2', 'PM2.5', 'TVOC'];
        const found = metrics
          .map((metric) => {
            const pattern = context?.patterns?.[metric];
            if (!pattern?.dominantWindow) return null;
            const stats = getMetricContext(context, metric)?.stats24h;
            if (!stats || stats.shareOutsideGood >= 0.2) return null;
            const window = TIME_OF_DAY_WINDOWS.find((w) => w.key === pattern.dominantWindow);
            return {
              metric,
              label: window?.label || 'einem Zeitfenster'
            };
          })
          .find(Boolean);
        return {
          id: 'localized_pattern_issue',
          metric: found?.metric || 'Muster',
          severity: 'info',
          tone: 'elevated',
          title: 'Belastung nur zu bestimmten Zeiten',
          summary: `Die Luft ist tagsüber meist gut, Problemzeiten konzentrieren sich auf ${found?.label || 'ein Fenster'}.`,
          recommendation: 'Zu den typischen Spitzen gezielt lüften oder Quellen vermeiden.',
          tags: ['pattern']
        };
      }
    },
    {
      id: 'humidity_too_dry',
      metric: 'rel. Feuchte',
      severity: 'warning',
      group: 'humidity',
      when: (context) => {
        const h = getMetricContext(context, 'rel. Feuchte');
        return h?.stats24h?.shareOutsideGood > 0.35 && Number.isFinite(h?.now?.value) && h.now.value < 40;
      },
      build: () => ({
        id: 'humidity_too_dry',
        metric: 'rel. Feuchte',
        severity: 'warning',
        tone: 'elevated',
        title: 'Luft zu trocken',
        summary: 'Über längere Zeit lag die Luftfeuchte unter dem Wohlfühlbereich.',
        recommendation: 'Luftbefeuchter nutzen, Pflanzen aufstellen oder Lüften reduzieren.',
        tags: ['feuchte']
      })
    },
    {
      id: 'humidity_too_humid',
      metric: 'rel. Feuchte',
      severity: 'critical',
      group: 'humidity',
      when: (context) => {
        const h = getMetricContext(context, 'rel. Feuchte');
        return h?.stats24h?.shareOutsideGood > 0.35 && Number.isFinite(h?.now?.value) && h.now.value > 65;
      },
      build: () => ({
        id: 'humidity_too_humid',
        metric: 'rel. Feuchte',
        severity: 'critical',
        tone: 'poor',
        title: 'Sehr feuchte Luft',
        summary: 'Hohe Luftfeuchte über viele Stunden – Schimmelgefahr.',
        recommendation: 'Intensiv lüften oder Entfeuchter nutzen, nasse Stellen trocknen.',
        tags: ['feuchte', 'lüften']
      })
    },
    {
      id: 'humidity_room_profile',
      metric: 'rel. Feuchte',
      severity: 'info',
      group: 'profile',
      when: (context) => {
        const profile = context?.roomProfile?.['rel. Feuchte'];
        return profile === 'tends_dry' || profile === 'tends_humid';
      },
      build: (context) => {
        const profile = context?.roomProfile?.['rel. Feuchte'];
        const isDry = profile === 'tends_dry';
        return {
          id: 'humidity_room_profile',
          metric: 'rel. Feuchte',
          severity: 'info',
          tone: isDry ? 'elevated' : 'warning',
          title: isDry ? 'Raum eher trocken' : 'Raum eher feucht',
          summary: isDry
            ? 'Die Luft war im letzten Monat überwiegend trocken.'
            : 'Die Luft war im letzten Monat eher auf der feuchten Seite.',
          recommendation: isDry
            ? 'Befeuchtung leicht erhöhen, Lüftung anpassen und trockene Phasen ausgleichen.'
            : 'Befeuchtung reduzieren, häufiger lüften und Feuchtequellen prüfen.',
          tags: ['feuchte', 'profil']
        };
      }
    },
    {
      id: 'temperature_comfort',
      metric: 'Temperatur',
      severity: 'info',
      group: 'temperature',
      when: (context) => {
        const t = getMetricContext(context, 'Temperatur');
        return t?.stats24h?.shareOutsideGood < 0.15 && t?.now?.tone === 'excellent';
      },
      build: () => ({
        id: 'temperature_comfort',
        metric: 'Temperatur',
        severity: 'info',
        tone: 'excellent',
        title: 'Komfortable Temperatur',
        summary: 'Temperatur liegt stabil im Wohlfühlbereich.',
        recommendation: 'Aktuelle Einstellungen beibehalten.',
        tags: ['komfort']
      })
    },
    {
      id: 'temperature_too_warm',
      metric: 'Temperatur',
      severity: 'warning',
      group: 'temperature',
      when: (context) => {
        const t = getMetricContext(context, 'Temperatur');
        return t?.stats24h?.shareOutsideGood > 0.3 && Number.isFinite(t?.now?.value) && t.now.value > 24;
      },
      build: () => ({
        id: 'temperature_too_warm',
        metric: 'Temperatur',
        severity: 'warning',
        tone: 'elevated',
        title: 'Temperatur eher hoch',
        summary: 'Die Raumtemperatur lag oft über dem Komfortbereich.',
        recommendation: 'Beschatten, kurz lüften oder Heizung reduzieren.',
        tags: ['komfort']
      })
    },
    {
      id: 'circadian_low_daylight',
      metric: 'Lux',
      severity: 'info',
      group: 'circadian',
      when: (context) => {
        const phase = context?.phase;
        const isDay = phase?.key === 'day' || phase?.key === 'mid-morning';
        const evals = context?.circadian;
        return isDay && evals && (evals.luxTone === 'elevated' || evals.luxTone === 'poor');
      },
      build: () => ({
        id: 'circadian_low_daylight',
        metric: 'Lux',
        severity: 'info',
        tone: 'elevated',
        title: 'Arbeitslicht zu schwach',
        summary: 'Tagsüber liegt die Beleuchtung unter dem Zielbereich.',
        recommendation: 'Helleres Arbeitslicht oder mehr Tageslicht einplanen.',
        tags: ['licht', 'circadian']
      })
    },
    {
      id: 'circadian_daytime_weak',
      metric: 'Lux',
      severity: 'info',
      group: 'circadian',
      when: (context) => {
        const luxMid = context?.patterns?.Lux?.windows?.midday;
        const cctMid = context?.patterns?.['Farbtemperatur']?.windows?.midday;
        return luxMid?.count >= 3 && luxMid.avg != null && luxMid.avg < 350 && (cctMid?.avg ?? 0) < 4200;
      },
      build: () => ({
        id: 'circadian_daytime_weak',
        metric: 'Lux',
        severity: 'info',
        tone: 'elevated',
        title: 'Arbeits-/Tageslicht eher schwach',
        summary: 'Zwischen 11 und 17 Uhr ist es oft zu dunkel oder zu warmes Licht für aktives Arbeiten.',
        recommendation: 'Tagsüber helleres und eher neutral/kühles Licht nutzen, um wacher zu bleiben.',
        tags: ['licht', 'circadian']
      })
    },
    {
      id: 'circadian_evening_relax',
      metric: 'Farbtemperatur',
      severity: 'info',
      group: 'circadian',
      when: (context) => {
        const luxEvening = context?.patterns?.Lux?.windows?.evening;
        const cctEvening = context?.patterns?.['Farbtemperatur']?.windows?.evening;
        if (!luxEvening || !cctEvening) return false;
        const tooBright = luxEvening.avg != null && luxEvening.avg > 280;
        const tooCool = cctEvening.avg != null && cctEvening.avg > 4200;
        const withinRelax =
          luxEvening.avg != null &&
          luxEvening.avg >= 50 &&
          luxEvening.avg <= 250 &&
          cctEvening.avg != null &&
          cctEvening.avg >= 2600 &&
          cctEvening.avg <= 3800;
        return tooBright || tooCool || withinRelax;
      },
      build: (context) => {
        const luxEvening = context?.patterns?.Lux?.windows?.evening;
        const cctEvening = context?.patterns?.['Farbtemperatur']?.windows?.evening;
        const tooBright = luxEvening?.avg != null && luxEvening.avg > 280;
        const tooCool = cctEvening?.avg != null && cctEvening.avg > 4200;
        const withinRelax =
          luxEvening?.avg != null &&
          luxEvening.avg >= 50 &&
          luxEvening.avg <= 250 &&
          cctEvening?.avg != null &&
          cctEvening.avg >= 2600 &&
          cctEvening.avg <= 3800;
        if (withinRelax && !tooBright && !tooCool) {
          return {
            id: 'circadian_evening_relax',
            metric: 'Farbtemperatur',
            severity: 'info',
            tone: 'excellent',
            title: 'Abendlicht passt',
            summary: 'Abendlicht liegt meist im entspannten Bereich – guter Feierabend-Modus.',
            recommendation: 'Aktuellen Abend-Lichtmodus beibehalten.',
            tags: ['licht', 'circadian']
          };
        }
        return {
          id: 'circadian_evening_relax',
          metric: 'Farbtemperatur',
          severity: 'warning',
          tone: 'elevated',
          title: 'Abendlicht wenig entspannend',
          summary: 'Abends ist das Licht eher hell oder kühl – wenig "Feierabend-Modus".',
          recommendation: 'Abends Licht dimmen und wärmer einstellen (gelblicher), indirekte Beleuchtung nutzen.',
          tags: ['licht', 'circadian']
        };
      }
    },
    {
      id: 'circadian_late_activity',
      metric: 'Lux',
      severity: 'info',
      group: 'circadian',
      when: (context) => {
        const luxLate = context?.patterns?.Lux?.windows?.late_evening;
        const cctLate = context?.patterns?.['Farbtemperatur']?.windows?.late_evening;
        if (!luxLate || !cctLate) return false;
        return (luxLate.avg ?? 0) > 150 || (cctLate.avg ?? 0) > 4200;
      },
      build: () => ({
        id: 'circadian_late_activity',
        metric: 'Lux',
        severity: 'info',
        tone: 'elevated',
        title: 'Später Abend noch sehr hell',
        summary: 'Zwischen 22 und 1 Uhr ist es oft noch recht hell oder kühl beleuchtet – Hinweis auf späte Aktivität.',
        recommendation: 'Wenn möglich Licht später stärker dimmen oder wärmer stellen, um zur Ruhe zu kommen.',
        tags: ['licht', 'circadian']
      })
    },
    {
      id: 'circadian_evening_bright',
      metric: 'Farbtemperatur',
      severity: 'warning',
      group: 'circadian',
      when: (context) => {
        const phase = context?.phase;
        const isEvening = phase?.key === 'evening' || phase?.key === 'late_evening';
        const evals = context?.circadian;
        return isEvening && evals && (evals.cctTone === 'poor' || evals.luxTone === 'poor');
      },
      build: () => ({
        id: 'circadian_evening_bright',
        metric: 'Farbtemperatur',
        severity: 'warning',
        tone: 'elevated',
        title: 'Abendlicht zu hell oder kühl',
        summary: 'Abends ist das Licht zu hell/kühl – kann den Schlaf stören.',
        recommendation: 'Licht dimmen und auf warme Farbtemperatur wechseln.',
        tags: ['licht', 'circadian']
      })
    },
    {
      id: 'combined_co2_humidity',
      metric: null,
      severity: 'critical',
      group: 'combined',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        const hum = getMetricContext(context, 'rel. Feuchte');
        return (
          co2?.stats24h?.shareOutsideGood > 0.35 &&
          hum?.stats24h?.shareOutsideGood > 0.35 &&
          Number.isFinite(hum?.now?.value) &&
          hum.now.value > 60
        );
      },
      build: () => ({
        id: 'combined_co2_humidity',
        metric: null,
        severity: 'critical',
        tone: 'poor',
        title: 'Schlecht gelüfteter Raum',
        summary: 'CO₂ und Luftfeuchte sind länger erhöht – Frischluft fehlt.',
        recommendation: 'Länger stoßlüften, Türen öffnen oder Lüftung verstärken.',
        tags: ['lüften', 'co2', 'feuchte']
      })
    },
      {
        id: 'combined_pm_tvoc',
        metric: null,
        severity: 'warning',
        group: 'combined',
      when: (context) => {
        const pm = getMetricContext(context, 'PM2.5');
        const voc = getMetricContext(context, 'TVOC');
        return (
          pm?.stats24h?.shareOutsideGood > 0.25 &&
          voc?.stats24h?.shareOutsideGood > 0.25 &&
          (pm?.now?.tone === 'elevated' || pm?.now?.tone === 'poor' || voc?.now?.tone === 'elevated' || voc?.now?.tone === 'poor')
        );
      },
      build: () => ({
        id: 'combined_pm_tvoc',
        metric: null,
        severity: 'warning',
        tone: 'elevated',
        title: 'Innenquellen wahrscheinlich',
        summary: 'Feinstaub und TVOC sind gleichzeitig erhöht – Quellen im Raum sind wahrscheinlich.',
        recommendation: 'Kochen, Kerzen oder Rauch reduzieren und gründlich lüften.',
        tags: ['pm', 'tvoc', 'lüften']
      })
    },
    {
      id: 'co2_evening_load',
      metric: 'CO2',
      severity: 'warning',
      group: 'pattern',
      when: (context) => {
        const pattern = context.patterns?.CO2;
        if (!pattern?.windows?.evening || !pattern?.windows?.midday) return false;
        const evening = pattern.windows.evening;
        const midday = pattern.windows.midday;
        return (
          Number.isFinite(evening.avg) &&
          Number.isFinite(midday.avg) &&
          evening.avg > midday.avg * 1.1 &&
          evening.outsideShare > 0.35
        );
      },
      build: () => ({
        id: 'co2_evening_load',
        metric: 'CO2',
        severity: 'warning',
        tone: 'elevated',
        title: 'Abendliche CO₂-Last',
        summary: 'CO₂ steigt regelmäßig zwischen 19–23 Uhr – wahrscheinlich Essenszeit oder viele Personen im Raum.',
        recommendation: 'Lüften direkt vor und nach dem Abendessen einplanen und Raumbelegung entzerren.',
        tags: ['co2', 'abend']
      })
    },
    {
      id: 'co2_exposure_score',
      metric: 'CO2',
      severity: 'info',
      group: 'profile',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return Number.isFinite(co2?.exposureScore);
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return {
          id: 'co2_exposure_score',
          metric: 'CO2',
          severity: 'info',
          tone: co2.exposureScore >= 80 ? 'excellent' : co2.exposureScore >= 60 ? 'good' : 'elevated',
          title: 'CO₂-Exposure Score',
          summary: `Gewichtete Belastung (24 h): ${co2.exposureScore}/100.`,
          recommendation: co2.exposureScore >= 70
            ? 'Belastung ist niedrig – aktuelle Lüftungsgewohnheiten beibehalten.'
            : 'Mehr Stoßlüften einplanen oder Querlüften, um die Belastung zu senken.',
          tags: ['co2', 'score']
        };
      }
    },
    {
      id: 'co2_peak_analysis',
      metric: 'CO2',
      severity: 'info',
      group: 'pattern',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return co2?.peakLoad?.count >= 1;
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return {
          id: 'co2_peak_analysis',
          metric: 'CO2',
          severity: 'info',
          tone: 'elevated',
          title: 'Spitzenlast-Analyse',
          summary: `${co2.peakLoad.count} Spitzen über 1400 ppm, gesamt ca. ${co2.peakLoad.totalMinutes} Minuten.`,
          recommendation: 'Lüftung frühzeitig starten, bevor 1400 ppm überschritten werden.',
          tags: ['co2', 'spitzen']
        };
      }
    },
    {
      id: 'co2_breath_footprint',
      metric: 'CO2',
      severity: 'info',
      group: 'profile',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return Number.isFinite(co2?.breathFootprint?.ppmPerMinute);
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        const footprint = co2?.breathFootprint;
        return {
          id: 'co2_breath_footprint',
          metric: 'CO2',
          severity: 'info',
          tone: footprint.ppmPerMinute > 40 ? 'elevated' : 'good',
          title: 'Atem-Footprint',
          summary: `CO₂-Anstieg ~${footprint.ppmPerMinute} ppm/min → ${footprint.label}.`,
          recommendation: 'Raum war stark belegt oder schlecht belüftet – Frischluft verbessern.',
          tags: ['co2', 'belegung']
        };
      }
    },
    {
      id: 'co2_vent_effectiveness',
      metric: 'CO2',
      severity: 'info',
      group: 'pattern',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        return Number.isFinite(co2?.ventEffectiveness?.ppmPerMinute);
      },
      build: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        const vent = co2?.ventEffectiveness;
        return {
          id: 'co2_vent_effectiveness',
          metric: 'CO2',
          severity: 'info',
          tone: vent.ppmPerMinute >= 80 ? 'excellent' : vent.ppmPerMinute >= 40 ? 'good' : 'elevated',
          title: 'Lüftungs-Effektivität',
          summary: `Nach Lüften fiel CO₂ mit ca. ${vent.ppmPerMinute} ppm/min → ${vent.label}.`,
          recommendation: vent.ppmPerMinute < 40
            ? 'Fenster weiter öffnen oder Querlüften, um den Abfall zu beschleunigen.'
            : 'Lüftungsroutine beibehalten – Abbau ist stark genug.',
          tags: ['co2', 'lüften']
        };
      }
    },
    {
      id: 'optimal_hours_summary',
      metric: 'CO2',
      severity: 'info',
      group: 'profile',
      when: (context) => {
        const metrics = ['CO2', 'TVOC', 'Temperatur', 'rel. Feuchte'];
        return metrics.some((metric) => getMetricContext(context, metric)?.optimalHours > 0.5);
      },
      build: (context) => {
        const metrics = ['CO2', 'TVOC', 'Temperatur', 'rel. Feuchte'];
        const parts = metrics
          .map((metric) => {
            const entry = getMetricContext(context, metric);
            if (!entry?.optimalHours) return null;
            return `${metricLabel(metric)} ${entry.optimalHours.toFixed(1)} h`;
          })
          .filter(Boolean);
        return {
          id: 'optimal_hours_summary',
          metric: 'CO2',
          severity: 'info',
          tone: 'good',
          title: 'Zeit im optimalen Bereich',
          summary: parts.join(' · '),
          recommendation: 'Ziel: jeweils ≥ 16 h/Tag im Komfortbereich halten.',
          tags: ['komfort', 'zeit']
        };
      }
    },
    {
      id: 'tvoc_source_score',
      metric: 'TVOC',
      severity: 'info',
      group: 'tvoc',
      when: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        return tvoc?.tvocSources != null;
      },
      build: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        const sources = tvoc?.tvocSources;
        return {
          id: 'tvoc_source_score',
          metric: 'TVOC',
          severity: 'info',
          tone: sources.rapidPeaks >= 2 ? 'elevated' : 'good',
          title: 'TVOC-Quellen-Score',
          summary: `${sources.rapidPeaks} schnelle Peaks, ${sources.lingering} langsame Abfälle – ${sources.suggestion}.`,
          recommendation: sources.rapidPeaks >= 2
            ? 'Lüften nach Reinigen/Kochen verlängern und Quellen lokalisieren.'
            : 'Lüftung beibehalten, Ausgasungen klingen bereits ab.',
          tags: ['tvoc', 'quelle']
        };
      }
    },
    {
      id: 'tvoc_slow_drop',
      metric: 'TVOC',
      severity: 'info',
      group: 'tvoc',
      when: (context) => {
        const tvoc = getMetricContext(context, 'TVOC');
        return tvoc?.shortTermTrend?.slope && tvoc.shortTermTrend.slope < 0 && Math.abs(tvoc.shortTermTrend.slope) < 5;
      },
      build: () => ({
        id: 'tvoc_slow_drop',
        metric: 'TVOC',
        severity: 'info',
        tone: 'good',
        title: 'TVOC sinkt langsam',
        summary: 'Quelle scheint inaktiv, Substanzen verflüchtigen sich nur noch.',
        recommendation: 'Kurz lüften beschleunigt den Abbau und entfernt Restausgasungen.',
        tags: ['tvoc', 'trend']
      })
    },
    {
      id: 'light_too_cool_evening',
      metric: 'Farbtemperatur',
      severity: 'info',
      group: 'light',
      when: (context) => {
        const phase = context.phase?.key;
        const now = state.now?.Farbtemperatur?.value;
        return phase === 'evening' && Number.isFinite(now) && now > 4200;
      },
      build: () => ({
        id: 'light_too_cool_evening',
        metric: 'Farbtemperatur',
        severity: 'info',
        tone: 'elevated',
        title: 'Lichtfarbe zu kühl',
        summary: 'Ab 17 Uhr ist die Lichtfarbe oft zu kühl – Raum wirkt aktiv statt entspannend.',
        recommendation: 'Auf 2700–3500 K und gedimmtes Licht für Wohnzimmer/Esszimmer wechseln.',
        tags: ['licht', 'cct']
      })
    },
    {
      id: 'temperature_night_drop',
      metric: 'Temperatur',
      severity: 'warning',
      group: 'temperature',
      when: (context) => {
        const pattern = context.patterns?.Temperatur;
        if (!pattern?.windows?.late_evening || !pattern?.windows?.morning) return false;
        const evening = pattern.windows.late_evening;
        const morning = pattern.windows.morning;
        if (!Number.isFinite(evening?.avg) || !Number.isFinite(morning?.avg)) return false;
        return evening.avg - morning.avg >= 3;
      },
      build: () => ({
        id: 'temperature_night_drop',
        metric: 'Temperatur',
        severity: 'warning',
        tone: 'elevated',
        title: 'Temperatur fällt nachts stark',
        summary: 'Nachts sinkt die Temperatur deutlich – Raum verliert Wärme zu schnell.',
        recommendation: 'Heizkurve oder Nachtabsenkung prüfen, Zugluftquellen abdichten.',
        tags: ['temperatur', 'nacht']
      })
    },
    {
      id: 'humidity_repeated_low',
      metric: 'rel. Feuchte',
      severity: 'warning',
      group: 'humidity',
      when: (context) => {
        const humidity = getMetricContext(context, 'rel. Feuchte');
        return humidity?.stats24h?.shareOutsideGood >= 0.4 && (humidity.now?.value ?? 50) < 40;
      },
      build: () => ({
        id: 'humidity_repeated_low',
        metric: 'rel. Feuchte',
        severity: 'warning',
        tone: 'elevated',
        title: 'Feuchtigkeit wiederholt niedrig',
        summary: 'Luft ist häufig trocken – wahrscheinlich Heizung/Winterbetrieb.',
        recommendation: 'Luftbefeuchter oder Schalen mit Wasser einsetzen und kürzer lüften.',
        tags: ['feuchte', 'trocken']
      })
    },
    {
      id: 'combined_co2_only',
      metric: null,
      severity: 'info',
      group: 'combined',
      when: (context) => {
        const co2 = getMetricContext(context, 'CO2');
        const pm = getMetricContext(context, 'PM2.5');
        const voc = getMetricContext(context, 'TVOC');
        return (
          co2?.now?.tone && ['elevated', 'poor', 'warning'].includes(co2.now.tone) &&
          (!pm || pm.now?.tone === 'excellent' || pm.now?.tone === 'good') &&
          (!voc || voc.now?.tone === 'excellent' || voc.now?.tone === 'good')
        );
      },
      build: () => ({
        id: 'combined_co2_only',
        metric: null,
        severity: 'info',
        tone: 'elevated',
        title: 'Viel Atemluft, wenig Partikel',
        summary: 'CO₂ ist erhöht, Feinstaub und TVOC sind normal – eher Lüftungsmangel.',
        recommendation: 'Mehr Frischluft einplanen, besonders bei vielen Personen.',
        tags: ['co2', 'lüften']
      })
    }
  ];

  function sortInsights(list) {
    const severityRank = { critical: 3, warning: 2, info: 1 };
    return (list || []).slice().sort((a, b) => {
      const aRank = severityRank[a?.severity] || 0;
      const bRank = severityRank[b?.severity] || 0;
      if (aRank !== bRank) return bRank - aRank;
      if (a.metric && b.metric && a.metric !== b.metric) return a.metric.localeCompare(b.metric);
      return (a.id || '').localeCompare(b.id || '');
    });
  }

  function evaluateInsightRules(context) {
    if (!context) return [];
    const results = [];
    for (const rule of INSIGHT_RULES) {
      try {
        if (rule.when(context)) {
          const insight = rule.build(context);
          if (insight) {
            results.push(insight);
          }
        }
      } catch (error) {
        console.error('Insight rule failed', rule?.id, error);
      }
    }
    return sortInsights(results);
  }

  function buildHeroSummary(context, insights, statuses, score) {
    const sortedInsights = sortInsights(insights);
    const top = sortedInsights[0];
    const baseTone = top?.tone || (score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'elevated' : 'poor');
    const co2 = getMetricContext(context, 'CO2');
    const pm = getMetricContext(context, 'PM2.5');
    const tvoc = getMetricContext(context, 'TVOC');

    const highlights = [];
    if (co2?.shortTermTrend?.classification?.startsWith('rising') && co2?.now?.tone !== 'excellent') {
      highlights.push('CO₂ erhöht und steigt gerade');
    } else if (co2?.elevationType === 'plateau' && co2?.now?.tone !== 'excellent') {
      highlights.push('CO₂ seit Stunden auf erhöhtem Niveau');
    }

    if (context?.roomProfile?.CO2 === 'frequently_high') {
      highlights.push('CO₂ über Wochen häufig erhöht');
    }
    const humidityProfile = context?.roomProfile?.['rel. Feuchte'];
    if (humidityProfile === 'tends_dry') highlights.push('Luft eher trocken');
    if (humidityProfile === 'tends_humid') highlights.push('Luft eher feucht');

    const patternWindow = context?.patterns?.CO2?.dominantWindow;
    if (patternWindow === 'evening') {
      highlights.push('abends höhere CO₂-Last');
    }

    const pmVolatile = pm?.volatility?.level === 'high' || tvoc?.volatility?.level === 'high';
    if (pmVolatile) {
      highlights.push('Luftschadstoffe schwanken stark');
    }

    if (!highlights.length && top?.summary) {
      highlights.push(top.summary.replace(/\.$/, ''));
    }

    const base =
      score >= 80
        ? 'Innenraumluft insgesamt gut'
        : score >= 60
          ? 'Luftqualität aktuell mittel'
          : 'Luftqualität derzeit belastet';
    const detail = highlights.slice(0, 2).join(' – ');
    const text = detail ? `${base} – ${detail}.` : `${base}.`;

    return { text, tone: baseTone };
  }

  function buildHeroHighlights(statuses, insights) {
    const highlights = [];
    const sortedInsights = sortInsights(insights);
    sortedInsights.slice(0, 3).forEach((insight) => {
      const text = insight?.summary || insight?.title;
      if (text) {
        highlights.push(text);
      }
    });

    const severityRank = { critical: 5, poor: 4, elevated: 3, warning: 3, good: 2, excellent: 1, neutral: 0 };
    const statusEntries = Object.entries(statuses || {}).sort((a, b) => {
      const aScore = severityRank[a?.[1]?.tone] || 0;
      const bScore = severityRank[b?.[1]?.tone] || 0;
      return bScore - aScore;
    });

    for (const [metric, status] of statusEntries) {
      if (highlights.length >= 3) break;
      const text = status?.note || `${metricLabel(metric)} ${status?.label || ''}`.trim();
      if (text) {
        highlights.push(text);
      }
    }

    return highlights.map((entry) => (entry.length > 120 ? `${entry.slice(0, 117)}…` : entry));
  }

  function buildCurrentStatuses() {
    const result = {};
    for (const metric of INSIGHT_METRICS) {
      const value = state.now?.[metric]?.value;
      if (!Number.isFinite(value)) continue;
      result[metric] = determineStatus(metric, value);
    }
    return result;
  }

  function getInsightForMetric(metric) {
    if (!metric || !Array.isArray(INSIGHT_STATE.insights)) return null;
    return INSIGHT_STATE.insights.find((entry) => entry.metric === metric) || null;
  }

  function renderInsights() {
    if (!ui.insightsSection || !ui.insightsGrid) return;
    const sorted = sortInsights(INSIGHT_STATE.insights);
    const visibleCount = INSIGHT_STATE.expanded ? sorted.length : Math.min(4, sorted.length);
    const list = sorted.slice(0, visibleCount);
    ui.insightsGrid.innerHTML = '';
    if (!list.length) {
      ui.insightsSection.hidden = true;
      if (ui.insightsToggle) ui.insightsToggle.hidden = true;
      return;
    }
    ui.insightsSection.hidden = false;
    if (ui.insightsToggle) {
      ui.insightsToggle.hidden = sorted.length <= 4;
      ui.insightsToggle.textContent = INSIGHT_STATE.expanded ? 'Weniger anzeigen' : 'Mehr Insights';
    }
    list.forEach((insight) => {
      const card = document.createElement('article');
      card.className = 'insight-card';
      card.dataset.severity = insight.severity || 'info';
      const meta = document.createElement('div');
      meta.className = 'insight-meta';
      const title = document.createElement('h3');
      title.textContent = insight.title || metricLabel(insight.metric || 'Insight');
      const badge = document.createElement('span');
      badge.className = 'insight-badge';
      badge.dataset.severity = insight.severity || 'info';
      badge.textContent = insight.severity === 'critical' ? 'Kritisch' : insight.severity === 'warning' ? 'Hinweis' : 'Info';
      meta.appendChild(title);
      meta.appendChild(badge);
      const summary = document.createElement('p');
      summary.textContent = insight.summary || '';
      const recommendation = document.createElement('p');
      recommendation.textContent = insight.recommendation || '';
      recommendation.className = 'status-tip';
      const micro = document.createElement('div');
      micro.className = 'insight-meter';
      for (let index = 0; index < 6; index++) {
        const bar = document.createElement('span');
        bar.dataset.severity = insight.severity || 'info';
        micro.appendChild(bar);
      }
      card.appendChild(meta);
      card.appendChild(summary);
      card.appendChild(micro);
      if (insight.recommendation) {
        card.appendChild(recommendation);
      }
      ui.insightsGrid.appendChild(card);
    });
  }

  async function refreshInsights() {
    try {
      const context = await buildInsightContext();
      const insights = evaluateInsightRules(context);
      const statuses = buildCurrentStatuses();
      const heroSummary = buildHeroSummary(context, insights, statuses, computeHealthScore());
      INSIGHT_STATE.context = context;
      INSIGHT_STATE.insights = insights;
      INSIGHT_STATE.heroSummary = heroSummary;
      renderInsights();
      updateHeroOverview(statuses);
      updateHealthCard(statuses);
    } catch (error) {
      console.error('Insight engine failed', error);
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
      const unitEls = card.querySelectorAll('.unit');
      const noteEl = card.querySelector('.status-note');
      const tipEl = card.querySelector('.status-tip');
      const badge = card.querySelector('.badge');
      const trendEl = card.querySelector('.trend');
      const config = METRIC_CONFIG[metric];

      if (!config) return;
      unitEls.forEach((unit) => {
        unit.textContent = config.unit;
      });

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
        const insight = getInsightForMetric(metric);
        if (valueEl) valueEl.textContent = formatNumber(sample.value, config.decimals);
        const noteText = insight?.summary || status.note;
        const tipText = insight?.recommendation || status.tip;
        if (noteEl) noteEl.textContent = noteText;
        if (tipEl) tipEl.textContent = tipText;
        if (badge) {
          badge.dataset.tone = status.tone || 'neutral';
          badge.textContent = status.label;
        }
        card.dataset.intent = status.intent || status.tone || 'neutral';
        const trend = computeTrend(metric);
        if (trendEl) {
          trendEl.textContent = trend ? `${trend.symbol} ${trendLabelFromSymbol(trend.symbol)}` : '→ stabil';
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
    renderCircadianMetricScale('lux', luxValue, phase);
    renderCircadianMetricScale('cct', cctValue, phase);
  }

  function updateCircadianModalChart(kind, data, targetRange) {
    const definition = kind === 'lux' ? CHART_DEFINITIONS.Lux : CHART_DEFINITIONS.Farbtemperatur;
    const metricKey = definition.metrics[0];
    const chart = ensureCircadianChart(kind, definition, metricKey);
    if (!chart) return;
    chart.data.datasets[0].data = data;
    const unit = METRIC_CONFIG[metricKey]?.unit || '';
    const hasRange = Array.isArray(targetRange) && targetRange.length >= 2;
    const targetGuideOptions = chart.options.plugins.targetGuides
      || (chart.options.plugins.targetGuides = {});
    const rangeGuides = hasRange
      ? [
          {
            min: targetRange[0],
            max: targetRange[1],
            color: STATUS_TONES.good,
            label: `Ziel ${formatRangeLabel(targetRange, unit)}`
          }
        ]
      : [];
    assignGuides(targetGuideOptions, rangeGuides);
    chart.options.plugins.tooltip = chart.options.plugins.tooltip || {};
    chart.options.plugins.tooltip.enabled = Array.isArray(data) && data.length > 0;
    scheduleChartUpdate(chart, 'none');
  }

  function ensureCircadianChart(kind, definition, metricKey) {
    const existing = state.circadianCharts[kind];
    if (existing) {
      try {
        existing.destroy();
      } catch (error) {
        console.warn('Circadian-Chart konnte nicht bereinigt werden', error);
      }
      state.circadianCharts[kind] = null;
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
            borderWidth: Chart.defaults.elements.line.borderWidth,
            tension: 0.32,
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
          tooltip: { enabled: false },
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

  function renderCircadianMetricScale(kind, value, phase) {
    const isLux = kind === 'lux';
    const scaleRoot = isLux ? ui.circadianScaleLux : ui.circadianScaleCct;
    if (!scaleRoot) return;
    const unit = isLux ? 'lx' : 'K';
    const bands = CIRCADIAN_SCALE_BANDS[kind] || [];
    renderMetricScale(scaleRoot, isLux ? 'Lux' : 'Farbtemperatur', value, {
      bands,
      unit,
      decimals: 0
    });

    const captionEl = isLux ? ui.circadianScaleLuxCaption : ui.circadianScaleCctCaption;
    const range = isLux ? phase.luxRange : phase.cctRange;
    if (captionEl && Array.isArray(range)) {
      captionEl.textContent = `Zielbereich für aktuellen Zeitraum: ${formatRangeLabel(range, unit)}`;
    }

    const currentEl = isLux ? ui.circadianScaleLuxValue : ui.circadianScaleCctValue;
    if (currentEl) {
      currentEl.textContent = formatWithUnit(value, unit, 0);
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

  function formatScaleTick(value, unit) {
    if (!Number.isFinite(value)) {
      return formatWithUnit(null, unit, 0);
    }
    const decimals = Math.abs(value) < 10 && unit !== 'ppm' ? 1 : 0;
    return formatWithUnit(value, unit, decimals);
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
    const definitions = Object.values(CHART_DEFINITIONS).filter(
      (definition) => !definition.optional || definition.metrics.some((metric) => SPARKLINE_METRICS.includes(metric))
    );
    const baseRange = TIME_RANGES[SPARKLINE_RANGE_KEY] || TIME_RANGES['24h'];
    state.range = baseRange;
    await Promise.all(definitions.map((definition) => ensureSeries(definition, baseRange, force)));
    updateSparklines();
    if (state.now) {
      updateStatusCards(state.now);
    }
    await refreshInsights();
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
    const names = new Set();
    const apiName = METRIC_CONFIG[metric]?.apiName;
    if (apiName) {
      names.add(apiName);
    }
    if (metric) {
      names.add(metric);
    }
    if (Array.isArray(list) && list.length) {
      list.forEach((entry) => {
        if (entry) {
          names.add(entry);
        }
      });
    }
    return Array.from(names);
  }

  async function requestSeries(metric, queryName, range, options = {}) {
    try {
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
          response = await fetchWithRetry(
            `/api/series?${params.toString()}`,
            {
              headers: { Accept: 'application/json' }
            },
            { signal: options.signal, label: `${metric}:${queryName}:${range.range}#${attempt + 1}` }
          );
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
        const backendUnreachable = payload?.error === 'backend_unreachable';
        if (!response.ok || !payload || !payload.ok) {
          if (backendUnreachable) {
            const err = new Error('Backend nicht erreichbar. Bitte erneut laden.');
            err.code = 'backend_unreachable';
            throw err;
          }
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
    } catch (error) {
      console.error('Zeitreihendaten konnten nicht geladen werden', error);
      throw error;
    }
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
    SPARKLINE_METRICS.forEach((metric) => {
      const sparkline = state.sparklines.get(metric);
      if (!sparkline) return;
      const definition = getDefinitionForMetric(metric);
      if (!definition) return;
      const cacheKey = `${definition.key}_${SPARKLINE_RANGE_KEY}`;
      const cached = state.chartDataCache.get(cacheKey);
      if (!cached) return;
      const data = prepareSparklineData(cached[metric] || []);
      sparkline.data.datasets[0].data = data;
      const card = ui.sparklineCards.get(metric);
      const sample = state.now?.[metric];
      const status = sample && isFinite(sample.value) ? determineStatus(metric, sample.value) : null;
      const tone = status?.tone || status?.intent || 'neutral';
      const color = toneToColor(tone) || definition.colors?.[0] || '#0ea5e9';
      sparkline.data.datasets[0].borderColor = color;
      sparkline.data.datasets[0].backgroundColor = colorWithAlpha(color, 0.18);
      scheduleChartUpdate(sparkline, 'none');
      if (card) {
        const labelEl = card.querySelector('.mini-meta h3, .core-name');
        const valueEl = card.querySelector('.mini-value, .core-number');
        const unitEl = card.querySelector('.mini-unit, .core-unit');
        if (labelEl) labelEl.textContent = METRIC_CONFIG[metric]?.label || metric;
        if (unitEl) unitEl.textContent = METRIC_CONFIG[metric]?.unit || '';
        if (valueEl) {
          valueEl.textContent = sample?.value != null
            ? formatNumber(sample.value, METRIC_CONFIG[metric]?.decimals)
            : '—';
        }
        card.classList.remove('skeleton');
        card.classList.add('ready');
        const container = card.querySelector('.mini-chart, .core-spark');
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
    if (!ui.modalScale || !ui.modalScaleBar) return;
    const normalized = normalizeScaleConfig(metric);
    const sample = state.now?.[metric];
    const config = METRIC_CONFIG[metric];
    const value = sample && isFinite(sample.value) ? sample.value : null;
    let caption = normalized.caption || '';

    if (metric === 'Lux' || metric === 'Farbtemperatur') {
      const phase = resolveCircadianPhase();
      const range = metric === 'Lux' ? phase.luxRange : phase.cctRange;
      if (Array.isArray(range) && range.length >= 2) {
        const formattedRange = `${formatNumber(range[0], 0)}–${formatNumber(range[1], 0)}${NARROW_SPACE}${normalized.unit}`;
        caption = `${phase.title}: Ziel ${formattedRange}`;
      }
    }

    const bands = resolveScaleBands(metric, normalized);
    if (!bands.length) {
      ui.modalScale.hidden = true;
      if (ui.modalScaleCaption) {
        ui.modalScaleCaption.textContent = '';
      }
      queueModalLayoutSync();
      return;
    }

    ui.modalScale.hidden = false;
    renderMetricScale(ui.modalScale, metric, value, {
      bands,
      unit: normalized.unit,
      decimals: config?.decimals ?? 0
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
    return { unit, min, max, caption, segments };
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

  function buildStandardSegments(min, max, span, configSegments = []) {
    const labels = ['Hervorragend', 'Gut', 'Erhöht', 'Schlecht'];
    const tones = ['excellent', 'good', 'elevated', 'poor'];
    const step = span / labels.length;
    const merged = labels.map((label, index) => ({
      label,
      tone: tones[index] || 'neutral',
      from: Infinity,
      to: -Infinity
    }));

    if (Array.isArray(configSegments)) {
      configSegments.forEach((segment) => {
        const tone = segment?.tone || 'neutral';
        const toneIndex = tones.indexOf(tone);
        if (toneIndex === -1) return;
        const start = Number.isFinite(segment.from)
          ? segment.from
          : Number.isFinite(segment.to)
            ? segment.to
            : min;
        const end = Number.isFinite(segment.to)
          ? segment.to
          : Number.isFinite(segment.from)
            ? segment.from
            : max;
        merged[toneIndex].from = Math.min(merged[toneIndex].from, Math.min(start, end));
        merged[toneIndex].to = Math.max(merged[toneIndex].to, Math.max(start, end));
      });
    }

    return merged.map((segment, index) => {
      const fallbackFrom = min + step * index;
      const fallbackTo = min + step * (index + 1);
      const resolvedFrom = Number.isFinite(segment.from) && segment.from !== Infinity
        ? clamp(segment.from, min, max)
        : fallbackFrom;
      const resolvedTo = Number.isFinite(segment.to) && segment.to !== -Infinity
        ? clamp(segment.to, min, max)
        : fallbackTo;
      const from = Math.min(resolvedFrom, resolvedTo);
      const to = Math.max(resolvedTo, resolvedFrom === resolvedTo ? resolvedFrom + step : resolvedTo);
      return {
        ...segment,
        from: clamp(from, min, max),
        to: clamp(to, min, max)
      };
    });
  }

  function resolveScaleBands(metric, normalized = null) {
    const configured = getMetricScaleBands(metric);
    if (configured?.length) {
      return configured.map((band) => ({ ...band }));
    }
    const scale = normalized || normalizeScaleConfig(metric);
    const segments = buildStandardSegments(
      scale.min,
      scale.max,
      Math.max(scale.max - scale.min, 1),
      scale.segments
    );
    return segments.map((segment) => ({
      tone: segment.tone || 'neutral',
      min: segment.from,
      max: segment.to,
      label: segment.label || STATUS_LABELS[segment.tone] || ''
    }));
  }

  function renderMetricScale(modalElement, metricKey, value, options = {}) {
    const scaleRoot = modalElement?.classList?.contains('metric-scale')
      ? modalElement
      : modalElement?.querySelector('.metric-scale');
    if (!scaleRoot) return;
    const bands = Array.isArray(options.bands) && options.bands.length
      ? options.bands
      : resolveScaleBands(metricKey);
    if (!bands || bands.length === 0) {
      scaleRoot.hidden = true;
      return;
    }
    scaleRoot.hidden = false;

    const bar = scaleRoot.querySelector('.metric-scale-bar');
    const labelRow = scaleRoot.querySelector('.metric-scale-label-row');
    if (!bar || !labelRow) return;

    let marker = bar.querySelector('.metric-scale-marker') || null;
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'metric-scale-marker';
      marker.setAttribute('aria-hidden', 'true');
    }

    if (!bar.contains(marker)) {
      bar.appendChild(marker);
    }

    bar.querySelectorAll('.metric-scale-segment').forEach((segment) => segment.remove());
    labelRow.innerHTML = '';

    const fallbackWidth = computeFallbackSpan(bands);
    const columnSpans = [];
    bands.forEach((band) => {
      const span = computeBandSpan(band, fallbackWidth);
      const segment = document.createElement('div');
      segment.className = `metric-scale-segment metric-scale-segment--tone-${band.tone || 'neutral'}`;
      segment.style.flexGrow = span;

      const labelEl = document.createElement('span');
      labelEl.textContent = band.label || STATUS_LABELS[band.tone] || STATUS_LABELS.neutral || '';

      columnSpans.push(span);
      labelRow.append(labelEl);
      bar.insertBefore(segment, marker);
    });

    if (columnSpans.length) {
      labelRow.style.gridTemplateColumns = columnSpans.map((span) => `${span}fr`).join(' ');
    } else {
      labelRow.style.gridTemplateColumns = '';
    }

    const percent = computeMarkerPercent(bands, value);
    const tone = determineBandTone(bands, value);
    marker.hidden = !Number.isFinite(value);
    marker.style.left = `${percent}%`;
    marker.dataset.tone = tone;
    if (Number.isFinite(value)) {
      marker.setAttribute('aria-label', formatWithUnit(value, options.unit || '', options.decimals ?? 0));
    } else {
      marker.removeAttribute('aria-label');
    }
  }

  function computeFallbackSpan(bands) {
    const finite = bands
      .map((band) => [Number(band.min), Number(band.max)])
      .filter(([minValue, maxValue]) => Number.isFinite(minValue) && Number.isFinite(maxValue) && maxValue > minValue);
    if (!finite.length) return 1;
    const min = Math.min(...finite.map(([minValue]) => minValue));
    const max = Math.max(...finite.map(([, maxValue]) => maxValue));
    return Math.max(max - min, 1);
  }

  function computeBandSpan(band, fallbackSpan) {
    const min = Number(band.min);
    const max = Number(band.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return max - min;
    }
    return fallbackSpan / 4;
  }

  function determineBandTone(bands, value) {
    if (!Array.isArray(bands) || !Number.isFinite(value)) {
      return 'neutral';
    }
    for (const band of bands) {
      const min = Number.isFinite(band.min) ? band.min : -Infinity;
      const max = Number.isFinite(band.max) ? band.max : Infinity;
      if (value >= min && value <= max) {
        return band.tone || 'neutral';
      }
    }
    if (!bands.length) {
      return 'neutral';
    }
    return value < (bands[0].min ?? value) ? bands[0].tone || 'neutral' : bands[bands.length - 1].tone || 'neutral';
  }

  function computeMarkerPercent(bands, value) {
    if (!Array.isArray(bands) || bands.length === 0) {
      return 50;
    }
    const finite = bands
      .map((band) => [Number(band.min), Number(band.max)])
      .filter(([minValue, maxValue]) => Number.isFinite(minValue) && Number.isFinite(maxValue));
    if (!finite.length) {
      return 50;
    }
    const min = Math.min(...finite.map(([minValue]) => minValue));
    const max = Math.max(...finite.map(([, maxValue]) => maxValue));
    const span = Math.max(max - min, 1);
    const target = Number.isFinite(value) ? clamp(value, min, max) : min + span / 2;
    return clamp(((target - min) / span) * 100, 0, 100);
  }

  function resolveScaleKey(metricKey) {
    if (!metricKey) return null;
    const key = String(metricKey).trim();
    if (METRIC_SCALE_CONFIG[key]) return key;
    const lower = key.toLowerCase();
    if (METRIC_SCALE_CONFIG[lower]) return lower;
    const alias = METRIC_SCALE_ALIASES[key] || METRIC_SCALE_ALIASES[lower];
    if (alias && METRIC_SCALE_CONFIG[alias]) return alias;
    return null;
  }

  function getMetricScaleBands(metricKey) {
    const resolved = resolveScaleKey(metricKey);
    if (!resolved) return null;
    const bands = METRIC_SCALE_CONFIG[resolved]?.bands;
    return Array.isArray(bands) ? bands.map((band) => ({ ...band })) : null;
  }

  function getMetricScaleMarkerLeft(metricKey, value) {
    const bands = getMetricScaleBands(metricKey);
    return computeMarkerPercent(bands || [], value);
  }

  function getDefinitionForMetric(metric) {
    const chartKey = METRIC_TO_CHART_KEY[metric];
    if (!chartKey) return null;
    return CHART_DEFINITIONS[chartKey] || null;
  }

  function openChartModal(metric) {
    const definition = getDefinitionForMetric(metric);
    if (!definition || !ui.modalRoot || !ui.modalCanvas) return;
    modalConfig.set({ metric, loading: true, error: null, empty: false });
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
    modalConfig.set({ metric: null, loading: false, error: null, empty: false });
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
    modalConfig.set({ loading: true, error: null, empty: false });
    try {
      const data = await ensureSeries(definition, range, force, { signal: controller.signal });
      if (state.modalRequestToken !== requestId) {
        if (state.modalAbortController === controller) {
          state.modalAbortController = null;
        }
        return;
      }
      const hasData = definition.metrics.some(
        (metricKey) => Array.isArray(data[metricKey]) && data[metricKey].length > 0
      );
      applyModalHeading(definition, range, activeMetric);
      if (!hasData) {
        teardownModalChart();
        modalConfig.set({ loading: false, error: null, empty: true });
        if (state.modalAbortController === controller) {
          state.modalAbortController = null;
        }
        return;
      }
      renderModalChart(definition, data, range, activeMetric);
      modalConfig.set({ loading: false, error: null, empty: false });
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
        tension: 0.32,
        fill: 'start',
        pointRadius: 0,
        pointHitRadius: 18,
        pointHoverRadius: 4,
        borderWidth: Chart.defaults.elements.line.borderWidth,
        spanGaps: true
      };
    });
    const hasSamples = datasets.some((dataset) => Array.isArray(dataset.data) && dataset.data.length > 0);
    const tooltipEnabled = datasets.some((dataset) => Array.isArray(dataset.data) && dataset.data.length > 1);
    const container = ui.modalCanvas.closest('.chart-modal__canvas');
    if (container) {
      container.classList.toggle('is-empty', !hasSamples);
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

    const options = buildModalChartOptions(definition, timeUnit, guides, tooltipEnabled, tooltipLabel);
    const config = {
      type: 'line',
      data: { datasets },
      plugins: [targetGuidePlugin],
      options
    };

    if (state.modalChart) {
      try {
        state.modalChart.destroy();
      } catch (error) {
        console.warn('Diagramm konnte nicht bereinigt werden', error);
      }
      state.modalChart = null;
    }

    state.modalChart = new Chart(ctx, config);
    recordTooltipPreference(state.modalChart, tooltipEnabled);
    syncTooltipState(state.modalChart, hasSamples);
    scheduleModalResize();
    queueModalLayoutSync();
  }

  function buildModalChartOptions(definition, timeUnit, guides, tooltipEnabled, tooltipLabel) {
    const safeGuides = Array.isArray(guides) ? guides.map((guide) => ({ ...guide })) : [];
    const isMobile = window.innerWidth < 640;
    const isTablet = window.innerWidth >= 640 && window.innerWidth < 1100;
    const xTickLimit = isMobile ? 4 : isTablet ? 6 : 8;
    const yTickLimit = isMobile ? 4 : 5;
    const layoutPadding = isMobile
      ? { top: 14, right: 12, bottom: 14, left: 10 }
      : isTablet
        ? { top: 18, right: 16, bottom: 18, left: 12 }
        : { top: 20, right: 18, bottom: 20, left: 14 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: layoutPadding },
      plugins: {
        legend: { labels: { color: '#475569', boxWidth: 12, boxHeight: 12, padding: 12 } },
        tooltip: {
          enabled: tooltipEnabled,
          callbacks: { label: tooltipLabel }
        },
        targetGuides: { guides: safeGuides }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: timeUnit,
            tooltipFormat: 'dd.MM.yyyy HH:mm'
          },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 12,
            maxTicksLimit: xTickLimit,
            color: '#94a3b8',
            font: { size: isMobile ? 10 : 11 }
          },
          grid: { display: false, drawBorder: false },
          border: { display: false }
        },
        y: {
          title: { display: true, text: definition.yTitle, color: '#9ca3af' },
          ticks: {
            color: '#94a3b8',
            maxTicksLimit: yTickLimit,
            font: { size: isMobile ? 10 : 11 },
            callback(value) {
              return formatScaleTick(value, definition.yTitle);
            }
          },
          grid: { color: 'rgba(148, 163, 184, 0.08)', lineWidth: 1, drawBorder: false, drawTicks: false },
          border: { display: false },
          suggestedMin: definition.yBounds?.min,
          suggestedMax: definition.yBounds?.max
        }
      }
    };
  }

  function handleModalError(error) {
    console.warn('Modal-Chart konnte nicht geladen werden', error);
    const code = error?.code;
    let message = typeof error === 'string' ? error : error?.message || 'Diagramm konnte nicht geladen werden.';
    if (code === 'backend_unreachable') {
      message = 'Backend nicht erreichbar. Bitte erneut laden.';
      teardownModalChart();
      modalConfig.set({ loading: false, error: message, empty: false });
      return;
    }
    modalConfig.set({ loading: false, error: message, empty: false });
    console.warn(message);
  }

  function retryModalChart() {
    const snapshot = modalConfig.get();
    if (!snapshot.metric) {
      return;
    }
    modalConfig.set({ error: null, loading: true });
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
      console.warn(message);
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
        console.warn(message);
      }
    } else {
      console.warn(message);
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) {
      console.info('Service Worker übersprungen (unsicherer Kontext)');
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
          ui.pwaStatusBadge.hidden = true;
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
        console.warn('AirGuard wurde installiert.');
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
            console.warn('Benachrichtigungen aktiviert.');
            subscribeForPush().catch((error) => console.warn('Push Registrierung fehlgeschlagen', error));
          } else {
            console.warn('Benachrichtigungen nicht erlaubt.');
          }
        } catch (error) {
          console.warn('Notification-Fehler', error);
        }
      });
    }
  }

  async function subscribeForPush() {
    if (!('serviceWorker' in navigator)) return;
    let registration;
    try {
      registration = await navigator.serviceWorker.ready;
    } catch (error) {
      console.info('Push-Registrierung übersprungen (Service Worker nicht aktiv).');
      return;
    }
    if (!registration || !('pushManager' in registration)) return;
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
    const code = error?.code;
    if (code === 'backend_unreachable') {
      console.info('Backend nicht erreichbar, erneuter Versuch empfohlen.');
      console.error('Backend nicht erreichbar. Bitte erneut versuchen.');
      return;
    }
    console.error(error);
    console.error(typeof error === 'string' ? error : error?.message || 'Unbekannter Fehler');
  }
})();
