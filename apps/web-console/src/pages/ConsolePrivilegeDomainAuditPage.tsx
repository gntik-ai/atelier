import React, { useEffect, useMemo, useState } from 'react';
import { queryPrivilegeDomainDenials, type DenialRecord } from '../services/privilege-domain-api';

type Filters = { tenantId?: string; workspaceId?: string; actorId?: string; requiredDomain?: string; from?: string; to?: string; limit: number; offset: number };

function toCsv(rows: DenialRecord[]) {
  const header = ['deniedAt','actorId','actorType','credentialDomain','requiredDomain','httpMethod','requestPath','sourceIp','correlationId'];
  const lines = rows.map((row) => header.map((key) => JSON.stringify((row as any)[key] ?? '')).join(','));
  return [header.join(','), ...lines].join('\n');
}

export default function ConsolePrivilegeDomainAuditPage() {
  const [filters, setFilters] = useState<Filters>({ limit: 50, offset: 0 });
  const [rows, setRows] = useState<DenialRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    queryPrivilegeDomainDenials(filters)
      .then((response) => {
        if (!active) return;
        setRows(response.denials);
        setTotal(response.total);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message ?? 'Failed to load denials');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters]);

  const last24hCount = useMemo(() => rows.filter((row) => Date.now() - new Date(row.deniedAt).getTime() <= 24 * 60 * 60 * 1000).length, [rows]);
  const csv = useMemo(() => toCsv(rows), [rows]);

  return (
    <div>
      <h1>Privilege Domain Denials</h1>
      <div>
        <select aria-label="requiredDomain" value={filters.requiredDomain ?? ''} onChange={(e) => setFilters({ ...filters, requiredDomain: e.target.value || undefined, offset: 0 })}>
          <option value="">all</option>
          <option value="structural_admin">structural_admin</option>
          <option value="data_access">data_access</option>
        </select>
        <input aria-label="tenantId" value={filters.tenantId ?? ''} onChange={(e) => setFilters({ ...filters, tenantId: e.target.value || undefined, offset: 0 })} />
        <input aria-label="workspaceId" value={filters.workspaceId ?? ''} onChange={(e) => setFilters({ ...filters, workspaceId: e.target.value || undefined, offset: 0 })} />
        <input aria-label="actorId" value={filters.actorId ?? ''} onChange={(e) => setFilters({ ...filters, actorId: e.target.value || undefined, offset: 0 })} />
      </div>
      <div data-testid="denial-badge">{last24hCount}</div>
      <a download="privilege-domain-denials.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Export CSV</a>
      {error ? <div role="alert">{error}</div> : null}
      {loading ? <div>Loading…</div> : (
        <table>
          <thead><tr><th>Denied At</th><th>Actor ID</th><th>Actor Type</th><th>Credential Domain</th><th>Required Domain</th><th>HTTP Method</th><th>Path</th><th>Source IP</th><th>Correlation ID</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={9}>No denials found.</td></tr> : rows.map((row) => (
              <tr key={row.id}><td>{row.deniedAt}</td><td>{row.actorId}</td><td>{row.actorType}</td><td>{row.credentialDomain}</td><td>{row.requiredDomain}</td><td>{row.httpMethod}</td><td>{row.requestPath}</td><td>{row.sourceIp}</td><td>{row.correlationId}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}>Previous</button>
      <button onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })} disabled={filters.offset + filters.limit >= total}>Next</button>
    </div>
  );
}
