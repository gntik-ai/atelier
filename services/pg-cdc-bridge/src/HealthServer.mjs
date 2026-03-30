import http from 'node:http';
export class HealthServer {
  constructor({ port = 8080, listenerManager, kafkaPublisher, metricsCollector }) { this.port = port; this.listenerManager = listenerManager; this.kafkaPublisher = kafkaPublisher; this.metricsCollector = metricsCollector; }
  start() {
    this.server = http.createServer((req, res) => {
      if (req.url === '/metrics') { res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }); res.end(this.metricsCollector?.toPrometheus?.() ?? ''); return; }
      if (req.url === '/health') { const listeners = this.listenerManager.health(); const ok = listeners.every((l) => l.isRunning) && this.kafkaPublisher.connected; res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', listeners })); return; }
      res.writeHead(404); res.end();
    }).listen(this.port);
  }
  stop() { return new Promise((resolve) => this.server?.close?.(() => resolve())); }
}
