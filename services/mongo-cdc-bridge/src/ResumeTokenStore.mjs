export class ResumeTokenStore {
  constructor(pool) { this.pool = pool; }
  async get(captureId) {
    const { rows } = await this.pool.query('SELECT resume_token FROM mongo_capture_resume_tokens WHERE capture_id = $1 LIMIT 1', [captureId]);
    return rows[0]?.resume_token ?? null;
  }
  async upsert(captureId, resumeToken) {
    const { rows } = await this.pool.query(`INSERT INTO mongo_capture_resume_tokens (capture_id, resume_token) VALUES ($1,$2::jsonb)
      ON CONFLICT (capture_id) DO UPDATE SET resume_token = $2::jsonb, updated_at = now() RETURNING *`, [captureId, JSON.stringify(resumeToken)]);
    return rows[0];
  }
  async delete(captureId) { await this.pool.query('DELETE FROM mongo_capture_resume_tokens WHERE capture_id = $1', [captureId]); }
}
