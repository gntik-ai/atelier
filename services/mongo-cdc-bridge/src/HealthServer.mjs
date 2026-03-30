import http from 'node:http';
export class HealthServer {
  constructor({ port = 8080, manager, metricsCollector }) { this.port = port; this.manager = manager; this.metricsCollector = metricsCollector; }
  start() {
    this.server = http.createServer((req, res) => {
      if (req.url === '/metrics') { res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }); res.end(this.metricsCollector?.toPrometheus?.() ?? ''); return; }
      if (req.url === '/health') {
        const active = this.manager.getActiveWatchers();
        const unhealthyStreams = active.filter((watcher) => !watcher.isHealthy()).map((watcher) => watcher.captureConfig.id);
        const ok = unhealthyStreams.length === 0;
        res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', activeStreams: active.length, unhealthyStreams }));
        return;
      }
      res.writeHead(404); res.end();
    }).listen(this.port);
  }
  close() { return new Promise((resolve) => this.server?.close?.(() => resolve())); }
}
