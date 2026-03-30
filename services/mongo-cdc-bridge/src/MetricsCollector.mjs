export class MetricsCollector {
  constructor() { this.samples = new Map(); }
  _key(name, labels = {}) { return `${name}|${JSON.stringify(labels)}`; }
  increment(name, labels = {}) { const key = this._key(name, labels); this.samples.set(key, { name, labels, value: (this.samples.get(key)?.value ?? 0) + 1, type: 'counter' }); }
  set(name, labels = {}, value = 0) { const key = this._key(name, labels); this.samples.set(key, { name, labels, value, type: 'gauge' }); }
  observe(name, labels = {}, value = 0) { const key = this._key(name, labels); this.samples.set(key, { name, labels, value, type: 'gauge' }); }
  toPrometheus() {
    return [...this.samples.values()].map(({ name, labels, value }) => {
      const renderedLabels = Object.entries(labels).map(([k, v]) => `${k}="${String(v)}"`).join(',');
      return `${name}${renderedLabels ? `{${renderedLabels}}` : ''} ${value}`;
    }).join('\n');
  }
}
