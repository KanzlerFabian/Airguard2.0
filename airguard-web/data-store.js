'use strict';

const path = require('path');
const fsp = require('fs/promises');

class DataStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.options = {
      snapshotLimit: options.snapshotLimit || 288,
      seriesLimit: options.seriesLimit || 150,
      flushDelayMs: options.flushDelayMs || 50
    };
    this.state = {
      snapshots: [],
      series: {}
    };
    this._flushTimer = null;
    this._ready = this._load();
  }

  get ready() {
    return this._ready;
  }

  async _load() {
    try {
      const existing = await fsp.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.snapshots)) {
          this.state.snapshots = parsed.snapshots
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => this._cloneSnapshot(entry))
            .filter(Boolean);
        }
        if (parsed.series && typeof parsed.series === 'object') {
          const series = {};
          for (const [key, value] of Object.entries(parsed.series)) {
            if (!key || !value || typeof value !== 'object') {
              continue;
            }
            const sanitized = this._sanitizeSeriesData(value.data);
            if (!sanitized.length) {
              continue;
            }
            const ts = Number(value.ts);
            series[key] = {
              ts: Number.isFinite(ts) ? ts : Date.now(),
              data: sanitized,
              meta: this._cloneMeta(value.meta)
            };
          }
          this.state.series = series;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[DataStore] Failed to load cache:', error);
      }
      await this._ensureDir();
    }
  }

  async recordSnapshot(payload) {
    await this.ready;
    if (!payload || typeof payload !== 'object' || !Number.isFinite(payload.ts)) {
      return;
    }
    this.state.snapshots.push(this._cloneSnapshot(payload));
    if (this.state.snapshots.length > this.options.snapshotLimit) {
      this.state.snapshots.splice(0, this.state.snapshots.length - this.options.snapshotLimit);
    }
    this._scheduleFlush();
  }

  latestSnapshot() {
    if (!Array.isArray(this.state.snapshots) || this.state.snapshots.length === 0) {
      return null;
    }
    const snapshot = this.state.snapshots[this.state.snapshots.length - 1];
    return snapshot ? this._cloneSnapshot(snapshot) : null;
  }

  async recordSeries(key, params, payload) {
    await this.ready;
    const normalizedKey = this._seriesKey(key, params);
    if (!normalizedKey) return;
    const sanitizedData = this._sanitizeSeriesData(payload?.data);
    if (!sanitizedData.length) {
      return;
    }
    this.state.series[normalizedKey] = {
      ts: Date.now(),
      data: sanitizedData,
      meta: this._cloneMeta(payload?.meta)
    };
    const keys = Object.keys(this.state.series);
    if (keys.length > this.options.seriesLimit) {
      const sorted = keys
        .map((k) => ({ key: k, ts: this.state.series[k]?.ts || 0 }))
        .sort((a, b) => a.ts - b.ts);
      while (sorted.length > this.options.seriesLimit) {
        const oldest = sorted.shift();
        if (oldest) {
          delete this.state.series[oldest.key];
        }
      }
    }
    this._scheduleFlush();
  }

  findSeries(key, params) {
    const normalizedKey = this._seriesKey(key, params);
    if (!normalizedKey) return null;
    const entry = this.state.series[normalizedKey];
    if (!entry) {
      return null;
    }
    return {
      ts: entry.ts,
      data: entry.data.map((point) => ({ x: point.x, y: point.y })),
      meta: this._cloneMeta(entry.meta)
    };
  }

  _seriesKey(key, params) {
    const name = typeof key === 'string' ? key.trim() : '';
    if (!name) return '';
    const range = params?.range ? String(params.range) : '';
    const step = params?.step ? String(params.step) : '';
    const win = params?.win ? String(params.win) : '';
    return [name, range, step, win].join('|');
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush().catch((error) => {
        console.warn('[DataStore] Failed to flush cache:', error);
      });
    }, this.options.flushDelayMs).unref();
  }

  async _flush() {
    await this.ready;
    const payload = JSON.stringify(this.state, null, 2);
    await this._ensureDir();
    await fsp.writeFile(this.filePath, payload, 'utf8');
  }

  async _ensureDir() {
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
  }

  _sanitizeSeriesData(raw) {
    if (!raw) {
      return [];
    }
    const values = Array.isArray(raw) ? raw : Array.isArray(raw?.values) ? raw.values : [];
    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }
    const sanitized = [];
    for (const entry of values) {
      if (!entry) continue;
      let x;
      let y;
      if (Array.isArray(entry) && entry.length >= 2) {
        x = Number(entry[0]);
        y = Number(entry[1]);
      } else if (typeof entry === 'object') {
        x = Number('x' in entry ? entry.x : entry.ts);
        y = Number('y' in entry ? entry.y : entry.value);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      sanitized.push({ x, y });
    }
    return sanitized;
  }

  _cloneMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(meta));
    } catch (error) {
      return { ...meta };
    }
  }

  _cloneSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }
    const cloned = this._cloneMeta(snapshot);
    if (!cloned || !Number.isFinite(cloned.ts)) {
      return null;
    }
    if (Array.isArray(cloned.snapshots)) {
      delete cloned.snapshots;
    }
    return cloned;
  }
}

module.exports = DataStore;
