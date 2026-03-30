export class MetricsCollector {
  constructor() { this.metrics = new Map(); }
  _key(metric, labels) { return `${metric}|${JSON.stringify(labels ?? {})}`; }
  increment(metric, labels = {}, amount = 1) { const key = this._key(metric, labels); const current = this.metrics.get(key) ?? { metric, labels, value: 0 }; current.value += amount; this.metrics.set(key, current); }
  set(metric, labels = {}, value) { this.metrics.set(this._key(metric, labels), { metric, labels, value }); }
  toPrometheus() { return [...this.metrics.values()].map(({ metric, labels, value }) => `${metric}{${Object.entries(labels).map(([k,v]) => `${k}="${v}"`).join(',')}} ${value}`).join('\n'); }
}
