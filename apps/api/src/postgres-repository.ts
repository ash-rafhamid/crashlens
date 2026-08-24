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
  StoredEvent,
  User,
  UserWithPassword,
  Workspace,
  WorkspaceRole
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

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'developer', 'viewer')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID
        REFERENCES workspaces(id) ON DELETE CASCADE;
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
      CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_kind ON auth_tokens(user_id, kind);
    `);

    await this.pool.query(
      `INSERT INTO projects (id, name, slug, api_key_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), "Demo Shopping Website", "cartly-shop", this.hashKey(this.demoApiKey)]
    );
  }

  async ensureBootstrapIdentity(input: {
    name: string;
    email: string;
    passwordHash: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1 FOR UPDATE",
        [input.email]
      );
      let userId: string;
      if (existing.rows[0]) {
        userId = String(existing.rows[0].id);
        await client.query(
          `UPDATE users
           SET name = $2, password_hash = $3, email_verified = TRUE
           WHERE id = $1`,
          [userId, input.name, input.passwordHash]
        );
      } else {
        userId = randomUUID();
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, email_verified)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [userId, input.name, input.email, input.passwordHash]
        );
      }

      const workspaceResult = await client.query(
        "SELECT id FROM workspaces WHERE slug = $1 LIMIT 1",
        [input.workspaceSlug]
      );
      let workspaceId: string;
      if (workspaceResult.rows[0]) {
        workspaceId = String(workspaceResult.rows[0].id);
      } else {
        workspaceId = randomUUID();
        await client.query(
          `INSERT INTO workspaces (id, name, slug, owner_user_id)
           VALUES ($1, $2, $3, $4)`,
          [workspaceId, input.workspaceName, input.workspaceSlug, userId]
        );
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'`,
        [workspaceId, userId]
      );
      await client.query("UPDATE projects SET workspace_id = $1 WHERE workspace_id IS NULL", [
        workspaceId
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email: string): Promise<UserWithPassword | null> {
    const result = await this.pool.query(
      `SELECT id, name, email, password_hash, email_verified, created_at
       FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToUserWithPassword(row) : null;
  }

  async createUserWithWorkspace(input: {
    name: string;
    email: string;
    passwordHash: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<{ user: User; workspace: Workspace } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const userResult = await client.query(
        `INSERT INTO users (id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, email_verified, created_at`,
        [userId, input.name, input.email, input.passwordHash]
      );
      const workspaceResult = await client.query(
        `INSERT INTO workspaces (id, name, slug, owner_user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, created_at`,
        [workspaceId, input.workspaceName, input.workspaceSlug, userId]
      );
      await client.query(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [workspaceId, userId]
      );
      await client.query("COMMIT");
      return {
        user: this.rowToUser(userResult.rows[0] as DatabaseRow),
        workspace: this.rowToWorkspace(workspaceResult.rows[0] as DatabaseRow, "owner")
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return null;
      throw error;
    } finally {
      client.release();
    }
  }

  async storeAuthToken(input: {
    userId: string;
    kind: "verify_email" | "reset_password";
    tokenHash: string;
    expiresAt: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM auth_tokens WHERE user_id = $1 AND kind = $2 AND used_at IS NULL",
        [input.userId, input.kind]
      );
      await client.query(
        "INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)",
        [input.tokenHash, input.userId, input.kind, input.expiresAt]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyEmailWithToken(tokenHash: string, now: string): Promise<User | null> {
    const result = await this.pool.query(
      `WITH consumed AS (
         UPDATE auth_tokens SET used_at = $2
         WHERE token_hash = $1 AND kind = 'verify_email'
           AND used_at IS NULL AND expires_at > $2
         RETURNING user_id
       )
       UPDATE users SET email_verified = TRUE
       FROM consumed WHERE users.id = consumed.user_id
       RETURNING users.id, users.name, users.email, users.email_verified, users.created_at`,
      [tokenHash, now]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  async resetPasswordWithToken(
    tokenHash: string,
    passwordHash: string,
    now: string
  ): Promise<User | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tokenResult = await client.query(
        `UPDATE auth_tokens SET used_at = $2
         WHERE token_hash = $1 AND kind = 'reset_password'
           AND used_at IS NULL AND expires_at > $2
         RETURNING user_id`,
        [tokenHash, now]
      );
      if (!tokenResult.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const userId = String(tokenResult.rows[0].user_id);
      const userResult = await client.query(
        `UPDATE users SET password_hash = $2 WHERE id = $1
         RETURNING id, name, email, email_verified, created_at`,
        [userId, passwordHash]
      );
      await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
      await client.query("COMMIT");
      return this.rowToUser(userResult.rows[0] as DatabaseRow);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [tokenHash, userId, expiresAt]
    );
  }

  async getSessionUser(tokenHash: string, now: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT u.id, u.name, u.email, u.email_verified, u.created_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.email_verified = TRUE`,
      [tokenHash, now]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    const result = await this.pool.query(
      `SELECT w.id, w.name, w.slug, w.created_at, m.role
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 ORDER BY w.name ASC`,
      [userId]
    );
    return result.rows.map((row) =>
      this.rowToWorkspace(row as DatabaseRow, String(row.role) as WorkspaceRole)
    );
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    const result = await this.pool.query(
      `SELECT p.id, p.name, p.slug, p.workspace_id, p.created_at
       FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id
       WHERE m.user_id = $1 ORDER BY p.name ASC`,
      [userId]
    );
    return result.rows.map((row) => this.rowToProject(row as DatabaseRow));
  }

  async getProjectForUser(userId: string, projectId: string): Promise<Project | null> {
    const result = await this.pool.query(
      `SELECT p.id, p.name, p.slug, p.workspace_id, p.created_at
       FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id
       WHERE m.user_id = $1 AND p.id = $2`,
      [userId, projectId]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  async createProjectForUser(
    userId: string,
    name: string,
    slug: string,
    apiKey: string
  ): Promise<Project | null> {
    try {
      const result = await this.pool.query(
        `INSERT INTO projects (id, name, slug, api_key_hash, workspace_id)
         SELECT $2, $3, $4, $5, m.workspace_id
         FROM workspace_members m
         WHERE m.user_id = $1 AND m.role IN ('owner', 'developer')
         ORDER BY m.created_at ASC LIMIT 1
         RETURNING id, name, slug, workspace_id, created_at`,
        [userId, randomUUID(), name, slug, this.hashKey(apiKey)]
      );
      const row = result.rows[0] as DatabaseRow | undefined;
      return row ? this.rowToProject(row) : null;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return null;
      throw error;
    }
  }

  async rotateProjectApiKeyForUser(
    userId: string,
    projectId: string,
    apiKey: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE projects p SET api_key_hash = $3
       FROM workspace_members m
       WHERE p.id = $2 AND m.user_id = $1
         AND m.workspace_id = p.workspace_id
         AND m.role IN ('owner', 'developer')
       RETURNING p.id`,
      [userId, projectId, this.hashKey(apiKey)]
    );
    return Boolean(result.rows[0]);
  }
  async findProjectByApiKey(apiKey: string): Promise<Project | null> {
    const result = await this.pool.query(
      "SELECT id, name, slug, workspace_id, created_at FROM projects WHERE api_key_hash = $1 LIMIT 1",
      [this.hashKey(apiKey)]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  async getProject(projectId: string): Promise<Project | null> {
    const result = await this.pool.query(
      "SELECT id, name, slug, workspace_id, created_at FROM projects WHERE id = $1",
      [projectId]
    );
    const row = result.rows[0] as DatabaseRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  async listProjects(): Promise<Project[]> {
    const result = await this.pool.query(
      "SELECT id, name, slug, workspace_id, created_at FROM projects ORDER BY name ASC"
    );
    return result.rows.map((row) => this.rowToProject(row as DatabaseRow));
  }

  async createProject(name: string, slug: string, apiKey: string): Promise<Project> {
    const result = await this.pool.query(
      `INSERT INTO projects (id, name, slug, api_key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, workspace_id, created_at`,
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
      workspaceId: row.workspace_id ? String(row.workspace_id) : null,
      createdAt: this.toIso(row.created_at)
    };
  }

  private rowToUser(row: DatabaseRow): User {
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      emailVerified: Boolean(row.email_verified),
      createdAt: this.toIso(row.created_at)
    };
  }

  private rowToUserWithPassword(row: DatabaseRow): UserWithPassword {
    return {
      ...this.rowToUser(row),
      passwordHash: String(row.password_hash)
    };
  }

  private rowToWorkspace(row: DatabaseRow, role: WorkspaceRole): Workspace {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      role,
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
