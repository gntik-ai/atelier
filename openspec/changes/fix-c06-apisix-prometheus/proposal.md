## Why

APISIX standalone route 1011 currently targets `public-api`; with the dedicated exporter enabled this returns 404 on :9080 while loopback :9091 serves metrics. The internal Prometheus client (P3 primary operator/SRE) therefore cannot scrape the contracted endpoint; P4 constrained/read-only auditors and P18 installers need the same documented behavior, while P13 adjacent/adversarial actors must gain no additional access.

## What Changes

Point the exact `/apisix/prometheus/metrics` route at loopback `127.0.0.1:9091`, retaining the dedicated exporter on loopback and Prometheus target `falcone-apisix:9080`. Port 9080 remains the already-declared gateway surface (now functional rather than 404); no additional listener, Service, or Ingress is opened. UI/backend/audit/quota layers do not apply to this configuration-only scrape path.
