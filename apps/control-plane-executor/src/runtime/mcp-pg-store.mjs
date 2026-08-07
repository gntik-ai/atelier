// Durable state store for the MCP management engine.
//
// The MCP engine keeps the reviewed curation/registry/quota logic in-process, but the core
// platform now runs that engine by default. Persisting the engine snapshot in the control-plane
// metadata database makes MCP servers, published versions, audit records, and rate windows survive
// executor restarts without adding a second service-specific database contract.
//
// Writes go through withStateTransaction(): it locks the single state row, reloads the current
// snapshot, lets the engine mutate that snapshot, then writes it back before commit. That avoids
// the stale whole-snapshot overwrite that two executor replicas can produce when they each load
// once and later replace the JSON document independently.

export function createMcpPostgresStore({ pool, tableName = 'falcone_mcp_state' } = {}) {
  if (!pool) throw new Error('createMcpPostgresStore requires a pg pool');
  const ident = tableName.split('.').map((part) => `"${String(part).replace(/"/g, '""')}"`).join('.');
  const STATE_ID = 'default';
  let schemaReady;

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS ${ident} (
          id text PRIMARY KEY,
          state jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    }
    await schemaReady;
  }

  async function loadState() {
    await ensureSchema();
    const { rows } = await pool.query(`SELECT state FROM ${ident} WHERE id = $1`, [STATE_ID]);
    return rows[0]?.state ?? null;
  }

  async function saveState(state) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO ${ident} (id, state, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE
         SET state = EXCLUDED.state,
             updated_at = EXCLUDED.updated_at`,
      [STATE_ID, JSON.stringify(state ?? {})],
    );
  }

  async function withStateTransaction(mutator) {
    if (typeof pool.connect !== 'function') {
      throw new Error('createMcpPostgresStore.withStateTransaction requires pool.connect');
    }
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ${ident} (id, state, updated_at)
         VALUES ($1, '{}'::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [STATE_ID],
      );
      const { rows } = await client.query(`SELECT state FROM ${ident} WHERE id = $1 FOR UPDATE`, [STATE_ID]);
      const current = rows[0]?.state ?? {};
      // Expose the transaction client so callers can commit related durable obligations in the
      // same transaction as the MCP JSON snapshot. Existing one-argument mutators are unchanged.
      const outcome = await mutator(structuredClone(current), client);
      const nextState = outcome?.state ?? {};
      await client.query(
        `UPDATE ${ident}
            SET state = $2::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [STATE_ID, JSON.stringify(nextState)],
      );
      await client.query('COMMIT');
      return outcome?.result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  return { ensureSchema, loadState, saveState, withStateTransaction };
}
