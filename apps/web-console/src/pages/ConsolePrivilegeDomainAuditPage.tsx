import React, { useEffect, useMemo, useState } from 'react';
import { queryPrivilegeDomainDenials, type DenialRecord } from '../services/privilege-domain-api';
import { useConsoleContext } from '../lib/console-context';
import { describeConsoleError } from '../lib/console-errors';

// C-14: scope (tenant + workspace) is bound to the authoritative shell context — NOT to editable
// free-form inputs — so a page control can never replace or spoof the active tenant/workspace. Only
// the non-scope filters below remain user-editable.
type Filters = { actorId?: string; requiredDomain?: string; from?: string; to?: string; limit: number; offset: number };

function toCsv(rows: DenialRecord[]) {
  const header = ['deniedAt','actorId','actorType','credentialDomain','requiredDomain','httpMethod','requestPath','sourceIp','correlationId'];
  const lines = rows.map((row) => header.map((key) => JSON.stringify((row as any)[key] ?? '')).join(','));
  return [header.join(','), ...lines].join('\n');
}

export default function ConsolePrivilegeDomainAuditPage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext();
  const [filters, setFilters] = useState<Filters>({ limit: 50, offset: 0 });
  const [rows, setRows] = useState<DenialRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No request unless BOTH active tenant and active workspace are present. Also drop any
    // prior-scope data so an incomplete context never keeps the previous tenant/workspace rows.
    if (!activeTenantId || !activeWorkspaceId) {
      setRows([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    // Clear prior-scope rows/total (and therefore the 24h badge and row-derived CSV that depend on
    // them) SYNCHRONOUSLY, before the new request starts. On a scope change or a failure the old
    // tenant/workspace rows must not stay visible or downloadable, and a superseded response must
    // not restore them.
    setRows([]);
    setTotal(0);
    setError(null);
    setLoading(true);

    queryPrivilegeDomainDenials(activeWorkspaceId, {
      tenantId: activeTenantId,
      requiredDomain: filters.requiredDomain,
      actorId: filters.actorId,
      from: filters.from,
      to: filters.to,
      limit: filters.limit,
      offset: filters.offset
    })
      .then((response) => {
        if (!active) return;
        setRows(response.denials);
        setTotal(response.total);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setRows([]);
        setTotal(0);
        setError(describeConsoleError(err, 'No se pudieron cargar las denegaciones del dominio de privilegio.'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeTenantId, activeWorkspaceId, filters]);

  const last24hCount = useMemo(() => rows.filter((row) => Date.now() - new Date(row.deniedAt).getTime() <= 24 * 60 * 60 * 1000).length, [rows]);
  const csv = useMemo(() => toCsv(rows), [rows]);

  return (
    <div>
      <h1>Denegaciones de dominios de privilegio</h1>
      {!activeTenantId ? (
        <div role="status" data-testid="privilege-domain-audit-tenant-required">
          Selecciona una organización activa para consultar el historial de denegaciones de dominios de privilegio.
        </div>
      ) : !activeWorkspaceId ? (
        <div role="status" data-testid="privilege-domain-audit-workspace-required">
          Selecciona un área de trabajo activa para consultar el historial de denegaciones de dominios de privilegio.
        </div>
      ) : (
        <>
          <p data-testid="privilege-domain-audit-scope">Organización {activeTenantId} · Área de trabajo {activeWorkspaceId}</p>
          <div>
            <select aria-label="Dominio requerido" value={filters.requiredDomain ?? ''} onChange={(e) => setFilters({ ...filters, requiredDomain: e.target.value || undefined, offset: 0 })}>
              <option value="">todos</option>
              <option value="structural_admin">structural_admin</option>
              <option value="data_access">data_access</option>
            </select>
            <input aria-label="ID del actor" value={filters.actorId ?? ''} onChange={(e) => setFilters({ ...filters, actorId: e.target.value || undefined, offset: 0 })} />
          </div>
          <div data-testid="denial-badge" aria-label="Denegaciones en las últimas 24 horas">{last24hCount}</div>
          {rows.length > 0 ? (
            <a download="privilege-domain-denials.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Exportar CSV</a>
          ) : (
            <button type="button" disabled aria-disabled="true">Exportar CSV</button>
          )}
          {error ? <div role="alert">{error}</div> : null}
          {loading ? <div role="status">Cargando…</div> : (
            <table aria-label="Historial de denegaciones de dominios de privilegio">
              <thead><tr><th scope="col">Denegado en</th><th scope="col">ID del actor</th><th scope="col">Tipo de actor</th><th scope="col">Dominio de credencial</th><th scope="col">Dominio requerido</th><th scope="col">Método HTTP</th><th scope="col">Ruta</th><th scope="col">IP de origen</th><th scope="col">ID de correlación</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={9}>No se encontraron denegaciones.</td></tr> : rows.map((row) => (
                  <tr key={row.id}><td>{row.deniedAt}</td><td>{row.actorId}</td><td>{row.actorType}</td><td>{row.credentialDomain}</td><td>{row.requiredDomain}</td><td>{row.httpMethod}</td><td>{row.requestPath}</td><td>{row.sourceIp}</td><td>{row.correlationId}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <button type="button" onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })} disabled={filters.offset === 0}>Anterior</button>
          <button type="button" onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })} disabled={filters.offset + filters.limit >= total}>Siguiente</button>
        </>
      )}
    </div>
  );
}
