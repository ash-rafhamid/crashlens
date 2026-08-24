import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type {
  Alert,
  AlertDeliveryStatus,
  AlertKind,
  CapturedEvent,
  Issue,
  IssueDetails,
  IssueStatus,
  Project,
  ProjectStats,
  RecordEventResult,
  StoredEvent
} from "./domain.js";
import type { IssueRepository } from "./repository.js";

const { Pool } = pg;

type DatabaseRow = Record<string, unknown>;

export class PostgresIssueRepository implements IssueRepository {
  readonly storageName = "postgresql";
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string, private readonly demoApiKey: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        api_key_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS issues (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        title TEXT NOT NULL,
        error_type TEXT NOT NULL,
        culprit TEXT,
        status TEXT NOT NULL DEFAULT 'unresolved'
          CHECK (status IN ('unresolved', 'resolved', 'ignored', 'regressed')),
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        first_seen TIMESTAMPTZ NOT NULL,
        last_seen TIMESTAMPTZ NOT NULL,
        latest_release TEXT,
        latest_environment TEXT,
        UNIQUE(project_id, fingerprint)
      );

      CREATE TABLE IF NOT EXISTS error_events (
        id UUID PRIMARY KEY,
        issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        error_type TEXT NOT NULL,
        stack TEXT,
        url TEXT,
        user_agent TEXT,
        browser_name TEXT,
        browser_version TEXT,
        browser_engine TEXT,
        operating_system TEXT,
        device_type TEXT,
        user_id TEXT,
        release TEXT,
        environment TEXT,
        context JSONB,
        breadcrumbs JSONB,
        occurred_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('new_issue', 'regression')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'stored'
          CHECK (delivery_status IN ('stored', 'delivered', 'failed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT;
      UPDATE projects SET slug = 'project-' || LEFT(id::text, 8) WHERE slug IS NULL;
      ALTER TABLE projects ALTER COLUMN slug SET NOT NULL;

      ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_name TEXT;
      ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_version TEXT;
      ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_engine TEXT;
      ALTER TABLE error_events ADD COLUMN IF NOT EXISTS operating_system TEXT;
      ALTER TABLE error_events ADD COLUMN IF NOT EXISTS device_type TEXT;

      CREATE INDEX IF NOT EXISTS idx_issues_project_last_seen
        ON issues(project_id, last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_events_issue_occurred
        ON error_events(issue_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_project_occurred
        ON error_events(project_id, occurred_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
      CREATE INDEX IF NOT EXISTS idx_alerts_project_created
        ON alerts(project_id, created_at DESC);
    `);

    await this.pool.query(
      `INSERT INTO projects (id, name, slug, api_key_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (api_key_hash) DO NOTHING`,
      [randomUUID(), "Demo Shopping Website", "cartly-shop", this.hashKey(this.demoApiKey)]
    );
  }

  async findProjectByApiKey(apiKey: string): Promise<Project | null> {
    const result = await this.pool.query(
      "SELECT id, name, slug, created_at FROM projects WHERE api_key_hash = $1 LIMIT 1",
      [this.hashKey(apiKey)]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  async getProject(projectId: string): Promise<Project | null> {
    const result = await this.pool.query(
      "SELECT id, name, slug, created_at FROM projects WHERE id = $1",
      [projectId]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  async listProjects(): Promise<Project[]> {
    const result = await this.pool.query(
      "SELECT id, name, slug, created_at FROM projects ORDER BY name ASC"
    );
    return result.rows.map((row) => this.rowToProject(row as DatabaseRow));
  }

  async createProject(name: string, slug: string, apiKey: string): Promise<Project> {
    const result = await this.pool.query(
      `INSERT INTO projects (id, name, slug, api_key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, created_at`,
      [randomUUID(), name, slug, this.hashKey(apiKey)]
    );
    return this.rowToProject(result.rows[0] as DatabaseRow);
  }

  async rotateProjectApiKey(projectId: string, apiKey: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE projects SET api_key_hash = $2 WHERE id = $1 RETURNING id",
      [projectId, this.hashKey(apiKey)]
    );
    return Boolean(result.rows[0]);
  }

  async recordEvent(
    project: Project,
    event: CapturedEvent,
    fingerprint: string,
    culprit: string | null
  ): Promise<RecordEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        project.id,
        fingerprint
      ]);
      const existingResult = await client.query(
        "SELECT * FROM issues WHERE project_id = $1 AND fingerprint = $2 FOR UPDATE",
        [project.id, fingerprint]
      );
      const existing = existingResult.rows[0] as DatabaseRow | undefined;
      let transition: AlertKind | null = null;
      let issueRow: DatabaseRow;

      if (existing) {
        transition = existing.status === "resolved" ? "regression" : null;
        const issueResult = await client.query(
          `UPDATE issues SET
             occurrence_count = occurrence_count + 1,
             last_seen = $3,
             latest_release = COALESCE($4, latest_release),
             latest_environment = COALESCE($5, latest_environment),
             status = CASE WHEN status = 'resolved' THEN 'regressed' ELSE status END
           WHERE project_id = $1 AND id = $2
           RETURNING *`,
          [
            project.id,
            existing.id,
            event.timestamp,
            event.release ?? null,
            event.environment ?? null
          ]
        );
        issueRow = issueResult.rows[0] as DatabaseRow;
      } else {
        transition = "new_issue";
        const issueResult = await client.query(
          `INSERT INTO issues (
             id, project_id, fingerprint, title, error_type, culprit,
             first_seen, last_seen, latest_release, latest_environment
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)
           RETURNING *`,
          [
            randomUUID(),
            project.id,
            fingerprint,
            event.message,
            event.type,
            culprit,
            event.timestamp,
            event.release ?? null,
            event.environment ?? null
          ]
        );
        issueRow = issueResult.rows[0] as DatabaseRow;
      }

      await client.query(
        `INSERT INTO error_events (
           id, issue_id, project_id, message, error_type, stack, url,
           user_agent, user_id, release, environment, context, breadcrumbs,
           browser_name, browser_version, browser_engine, operating_system, device_type, occurred_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb,
           $14, $15, $16, $17, $18, $19
         )`,
        [
          randomUUID(),
          issueRow.id,
          project.id,
          event.message,
          event.type,
          event.stack ?? null,
          event.url ?? null,
          event.userAgent ?? null,
          event.userId ?? null,
          event.release ?? null,
          event.environment ?? null,
          JSON.stringify(event.context ?? {}),
          JSON.stringify(event.breadcrumbs ?? []),
          event.browser?.name ?? null,
          event.browser?.version ?? null,
          event.browser?.engine ?? null,
          event.browser?.operatingSystem ?? null,
          event.browser?.deviceType ?? null,
          event.timestamp
        ]
      );

      const userResult = await client.query(
        `SELECT COUNT(DISTINCT user_id)::int AS affected_users
         FROM error_events WHERE issue_id = $1 AND user_id IS NOT NULL`,
        [issueRow.id]
      );
      await client.query("COMMIT");

      return {
        issue: this.rowToIssue({
          ...issueRow,
          affected_users: userResult.rows[0]?.affected_users ?? 0
        }),
        transition
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listIssues(projectId: string, status?: IssueStatus): Promise<Issue[]> {
    const values: unknown[] = [projectId];
    const statusClause = status ? "AND i.status = $2" : "";
    if (status) {
      values.push(status);
    }

    const result = await this.pool.query(
      `SELECT i.*,
        (SELECT COUNT(DISTINCT e.user_id)::int
         FROM error_events e
         WHERE e.issue_id = i.id AND e.user_id IS NOT NULL) AS affected_users
       FROM issues i
       WHERE i.project_id = $1 ${statusClause}
       ORDER BY i.last_seen DESC`,
      values
    );
    return result.rows.map((row) => this.rowToIssue(row as DatabaseRow));
  }

  async getIssue(projectId: string, issueId: string): Promise<IssueDetails | null> {
    const issueResult = await this.pool.query(
      `SELECT i.*,
        (SELECT COUNT(DISTINCT e.user_id)::int
         FROM error_events e
         WHERE e.issue_id = i.id AND e.user_id IS NOT NULL) AS affected_users
       FROM issues i
       WHERE i.project_id = $1 AND i.id = $2`,
      [projectId, issueId]
    );
    const issueRow = issueResult.rows[0] as DatabaseRow | undefined;
    if (!issueRow) {
      return null;
    }

    const eventResult = await this.pool.query(
      `SELECT * FROM error_events
       WHERE project_id = $1 AND issue_id = $2
       ORDER BY occurred_at DESC
       LIMIT 50`,
      [projectId, issueId]
    );

    return {
      ...this.rowToIssue(issueRow),
      events: eventResult.rows.map((row) => this.rowToEvent(row as DatabaseRow))
    };
  }

  async updateIssueStatus(
    projectId: string,
    issueId: string,
    status: Exclude<IssueStatus, "regressed">
  ): Promise<Issue | null> {
    const result = await this.pool.query(
      `UPDATE issues SET status = $3
       WHERE project_id = $1 AND id = $2
       RETURNING id`,
      [projectId, issueId, status]
    );
    if (!result.rows[0]) {
      return null;
    }
    const details = await this.getIssue(projectId, issueId);
    if (!details) {
      return null;
    }
    const { events: _events, ...issue } = details;
    return issue;
  }

  async getStats(projectId: string): Promise<ProjectStats> {
    const result = await this.pool.query(
      `SELECT
         COALESCE((SELECT SUM(occurrence_count) FROM issues WHERE project_id = $1), 0)::int
           AS total_events,
         (SELECT COUNT(*) FROM issues
          WHERE project_id = $1 AND status IN ('unresolved', 'regressed'))::int
           AS unresolved_issues,
         (SELECT COUNT(DISTINCT user_id) FROM error_events
          WHERE project_id = $1 AND user_id IS NOT NULL)::int
           AS affected_users,
         (SELECT COUNT(*) FROM error_events
          WHERE project_id = $1 AND occurred_at >= CURRENT_DATE)::int
           AS events_today`,
      [projectId]
    );
    const row = result.rows[0] as DatabaseRow;
    return {
      totalEvents: Number(row.total_events),
      unresolvedIssues: Number(row.unresolved_issues),
      affectedUsers: Number(row.affected_users),
      eventsToday: Number(row.events_today)
    };
  }

  async createAlert(
    projectId: string,
    issueId: string,
    kind: AlertKind,
    title: string,
    message: string
  ): Promise<Alert> {
    const result = await this.pool.query(
      `INSERT INTO alerts (id, project_id, issue_id, kind, title, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [randomUUID(), projectId, issueId, kind, title, message]
    );
    return this.rowToAlert(result.rows[0] as DatabaseRow);
  }

  async updateAlertDelivery(alertId: string, status: AlertDeliveryStatus): Promise<void> {
    await this.pool.query("UPDATE alerts SET delivery_status = $2 WHERE id = $1", [alertId, status]);
  }

  async listAlerts(projectId: string, limit = 20): Promise<Alert[]> {
    const result = await this.pool.query(
      `SELECT * FROM alerts WHERE project_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit]
    );
    return result.rows.map((row) => this.rowToAlert(row as DatabaseRow));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private rowToProject(row: DatabaseRow): Project {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      createdAt: this.toIso(row.created_at)
    };
  }

  private rowToAlert(row: DatabaseRow): Alert {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      issueId: String(row.issue_id),
      kind: String(row.kind) as AlertKind,
      title: String(row.title),
      message: String(row.message),
      createdAt: this.toIso(row.created_at),
      deliveryStatus: String(row.delivery_status) as AlertDeliveryStatus
    };
  }

  private rowToIssue(row: DatabaseRow): Issue {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      fingerprint: String(row.fingerprint),
      title: String(row.title),
      errorType: String(row.error_type),
      culprit: row.culprit ? String(row.culprit) : null,
      status: String(row.status) as IssueStatus,
      occurrenceCount: Number(row.occurrence_count),
      affectedUsers: Number(row.affected_users ?? 0),
      firstSeen: this.toIso(row.first_seen),
      lastSeen: this.toIso(row.last_seen),
      latestRelease: row.latest_release ? String(row.latest_release) : null,
      latestEnvironment: row.latest_environment ? String(row.latest_environment) : null
    };
  }

  private rowToEvent(row: DatabaseRow): StoredEvent {
    return {
      id: String(row.id),
      issueId: String(row.issue_id),
      type: String(row.error_type),
      message: String(row.message),
      stack: row.stack ? String(row.stack) : undefined,
      timestamp: this.toIso(row.occurred_at),
      release: row.release ? String(row.release) : undefined,
      environment: row.environment ? String(row.environment) : undefined,
      url: row.url ? String(row.url) : undefined,
      userAgent: row.user_agent ? String(row.user_agent) : undefined,
      browser: row.browser_name
        ? {
            name: String(row.browser_name),
            version: row.browser_version ? String(row.browser_version) : undefined,
            engine: row.browser_engine ? String(row.browser_engine) : "Unknown engine",
            operatingSystem: row.operating_system ? String(row.operating_system) : "Unknown OS",
            deviceType: (row.device_type ? String(row.device_type) : "Desktop") as
              | "Desktop"
              | "Mobile"
              | "Tablet"
          }
        : undefined,
      userId: row.user_id ? String(row.user_id) : undefined,
      context: (row.context as Record<string, unknown> | null) ?? undefined,
      breadcrumbs: (row.breadcrumbs as StoredEvent["breadcrumbs"] | null) ?? undefined,
      createdAt: this.toIso(row.created_at)
    };
  }

  private toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  }
}
