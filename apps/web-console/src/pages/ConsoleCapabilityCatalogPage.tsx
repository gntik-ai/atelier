import React, { useEffect, useState } from 'react';
import { publicApiFetch } from '@/lib/http';

function defaultFetcher(workspaceId: string) {
  return publicApiFetch(`/v1/workspaces/${workspaceId}/capability-catalog`).then((response) => {
    if (!response.ok) {
      throw new Error(`La solicitud falló con estado ${response.status}`);
    }

    return response.json();
  });
}

type CapabilityExample = {
  operationId: string;
  label: string;
  language: string;
  code: string;
};

type CapabilityItem = {
  id: string;
  displayName: string;
  enabled: boolean;
  status: string;
  dependencyNote?: string;
  enablementGuide?: string;
  quota?: Record<string, string | number>;
  examples: CapabilityExample[];
};

type CatalogResponse = {
  workspaceId: string;
  capabilities: CapabilityItem[];
};

export function ConsoleCapabilityCatalogPage({
  workspaceId,
  workspaceName,
  fetcher = defaultFetcher
}: {
  workspaceId: string;
  workspaceName?: string;
  fetcher?: (workspaceId: string) => Promise<CatalogResponse>;
}) {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    fetcher(workspaceId)
      .then((response) => {
        if (active) {
          setData(response);
        }
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError instanceof Error ? fetchError : new Error('Error desconocido'));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [fetcher, workspaceId]);

  if (loading) {
    return <div data-testid="catalog-loading">Cargando catálogo de capacidades…</div>;
  }

  if (error) {
    return (
      <div role="alert">
        <p>No se pudo cargar el catálogo de capacidades.</p>
        <button onClick={() => fetcher(workspaceId).then(setData).catch(setError)}>Reintentar</button>
      </div>
    );
  }

  return (
    <section>
      <header>
        <h1>Catálogo de capacidades</h1>
        <p>{workspaceName ?? data?.workspaceId ?? workspaceId}</p>
      </header>
      <div>
        {data?.capabilities.map((capability) => (
          <article key={capability.id} data-testid={`capability-${capability.id}`}>
            <h2>{capability.displayName}</h2>
            <span>{capability.enabled ? 'Habilitada' : 'Deshabilitada'}</span>
            {capability.status !== 'active' && capability.status !== 'disabled' ? <span>{capability.status}</span> : null}
            {capability.dependencyNote ? <p>{capability.dependencyNote}</p> : null}
            {capability.quota ? (
              <ul>
                {Object.entries(capability.quota).map(([key, value]) => (
                  <li key={key}>{`${key}: ${value}`}</li>
                ))}
              </ul>
            ) : null}
            {capability.enabled ? (
              <div>
                {capability.examples.map((example) => (
                  <details key={example.operationId} open>
                    <summary>{example.label}</summary>
                    <pre>
                      <code>{example.code}</code>
                    </pre>
                  </details>
                ))}
              </div>
            ) : (
              <p>{capability.enablementGuide}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default ConsoleCapabilityCatalogPage;
