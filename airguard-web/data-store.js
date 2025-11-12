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
          this.state.snapshots = parsed.snapshots.filter((entry) =>
            entry && typeof entry === 'object' && Number.isFinite(entry.ts)
          );
        }
        if (parsed.series && typeof parsed.series === 'object') {
          this.state.series = Object.fromEntries(
            Object.entries(parsed.series).filter(([key, value]) =>
              key && value && typeof value === 'object'
            )
          );
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
    this.state.snapshots.push(payload);
    if (this.state.snapshots.length > this.options.snapshotLimit) {
      this.state.snapshots.splice(0, this.state.snapshots.length - this.options.snapshotLimit);
    }
    this._scheduleFlush();
  }

  latestSnapshot() {
    if (!Array.isArray(this.state.snapshots) || this.state.snapshots.length === 0) {
      return null;
    }
    return this.state.snapshots[this.state.snapshots.length - 1] || null;
  }

  async recordSeries(key, params, payload) {
    await this.ready;
    const normalizedKey = this._seriesKey(key, params);
    if (!normalizedKey) return;
    this.state.series[normalizedKey] = {
      ts: Date.now(),
      data: Array.isArray(payload?.data) ? payload.data : [],
      meta: payload?.meta || null
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
    return this.state.series[normalizedKey] || null;
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
}

module.exports = DataStore;
