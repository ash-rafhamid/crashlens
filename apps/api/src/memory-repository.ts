import { createHash, randomUUID } from "node:crypto";
import type {
  Alert,
  AlertDeliveryStatus,
  AlertKind,
  AuthTokenKind,
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

interface InternalIssue extends Issue {
  userIds: Set<string>;
}

interface InternalWorkspace {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  createdAt: string;
}

interface InternalAuthToken {
  userId: string;
  kind: AuthTokenKind;
  expiresAt: string;
  usedAt: string | null;
}

export class MemoryIssueRepository implements IssueRepository {
  readonly storageName = "memory";
  private readonly projectsByKeyHash = new Map<string, Project>();
  private readonly projects = new Map<string, Project>();
  private readonly issues = new Map<string, InternalIssue>();
  private readonly events = new Map<string, StoredEvent[]>();
  private readonly alerts = new Map<string, Alert>();
  private readonly users = new Map<string, UserWithPassword>();
  private readonly userIdsByEmail = new Map<string, string>();
  private readonly workspaces = new Map<string, InternalWorkspace>();
  private readonly workspaceIdsBySlug = new Map<string, string>();
  private readonly memberships = new Map<string, Map<string, WorkspaceRole>>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: string }>();
  private readonly authTokens = new Map<string, InternalAuthToken>();

  constructor(private readonly demoApiKey: string) {}

  async initialize(): Promise<void> {
    const project: Project = {
      id: "demo-project",
      name: "Demo Shopping Website",
      slug: "cartly-shop",
      workspaceId: null,
      createdAt: new Date().toISOString()
    };
    this.projects.set(project.id, project);
    this.projectsByKeyHash.set(this.hashKey(this.demoApiKey), project);
  }

  async ensureBootstrapIdentity(input: {
    name: string;
    email: string;
    passwordHash: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<void> {
    let user = await this.findUserByEmail(input.email);
    if (!user) {
      user = {
        id: randomUUID(),
        name: input.name,
        email: input.email,
        emailVerified: true,
        passwordHash: input.passwordHash,
        createdAt: new Date().toISOString()
      };
      this.users.set(user.id, user);
      this.userIdsByEmail.set(user.email, user.id);
    } else {
      user.name = input.name;
      user.passwordHash = input.passwordHash;
      user.emailVerified = true;
    }

    let workspaceId = this.workspaceIdsBySlug.get(input.workspaceSlug);
    if (!workspaceId) {
      workspaceId = randomUUID();
      const workspace: InternalWorkspace = {
        id: workspaceId,
        name: input.workspaceName,
        slug: input.workspaceSlug,
        ownerUserId: user.id,
        createdAt: new Date().toISOString()
      };
      this.workspaces.set(workspace.id, workspace);
      this.workspaceIdsBySlug.set(workspace.slug, workspace.id);
    }

    this.addMembership(user.id, workspaceId, "owner");
    for (const project of this.projects.values()) {
      if (!project.workspaceId) project.workspaceId = workspaceId;
    }
  }

  async findUserByEmail(email: string): Promise<UserWithPassword | null> {
    const userId = this.userIdsByEmail.get(email);
    return userId ? this.users.get(userId) ?? null : null;
  }

  async createUserWithWorkspace(input: {
    name: string;
    email: string;
    passwordHash: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<{ user: User; workspace: Workspace } | null> {
    if (this.userIdsByEmail.has(input.email) || this.workspaceIdsBySlug.has(input.workspaceSlug)) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const user: UserWithPassword = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      emailVerified: false,
      passwordHash: input.passwordHash,
      createdAt
    };
    const internalWorkspace: InternalWorkspace = {
      id: randomUUID(),
      name: input.workspaceName,
      slug: input.workspaceSlug,
      ownerUserId: user.id,
      createdAt
    };
    this.users.set(user.id, user);
    this.userIdsByEmail.set(user.email, user.id);
    this.workspaces.set(internalWorkspace.id, internalWorkspace);
    this.workspaceIdsBySlug.set(internalWorkspace.slug, internalWorkspace.id);
    this.addMembership(user.id, internalWorkspace.id, "owner");

    return {
      user: this.toPublicUser(user),
      workspace: this.toPublicWorkspace(internalWorkspace, "owner")
    };
  }

  async storeAuthToken(input: {
    userId: string;
    kind: AuthTokenKind;
    tokenHash: string;
    expiresAt: string;
  }): Promise<void> {
    for (const [hash, token] of this.authTokens) {
      if (token.userId === input.userId && token.kind === input.kind && !token.usedAt) {
        this.authTokens.delete(hash);
      }
    }
    this.authTokens.set(input.tokenHash, {
      userId: input.userId,
      kind: input.kind,
      expiresAt: input.expiresAt,
      usedAt: null
    });
  }

  async verifyEmailWithToken(tokenHash: string, now: string): Promise<User | null> {
    const token = this.authTokens.get(tokenHash);
    if (!token || token.kind !== "verify_email" || token.usedAt || token.expiresAt <= now) {
      return null;
    }
    const user = this.users.get(token.userId);
    if (!user) return null;
    token.usedAt = now;
    user.emailVerified = true;
    return this.toPublicUser(user);
  }

  async resetPasswordWithToken(
    tokenHash: string,
    passwordHash: string,
    now: string
  ): Promise<User | null> {
    const token = this.authTokens.get(tokenHash);
    if (!token || token.kind !== "reset_password" || token.usedAt || token.expiresAt <= now) {
      return null;
    }
    const user = this.users.get(token.userId);
    if (!user) return null;
    token.usedAt = now;
    user.passwordHash = passwordHash;
    for (const [hash, session] of this.sessions) {
      if (session.userId === user.id) this.sessions.delete(hash);
    }
    return this.toPublicUser(user);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async getSessionUser(tokenHash: string, now: string): Promise<User | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) {
      if (session) this.sessions.delete(tokenHash);
      return null;
    }
    const user = this.users.get(session.userId);
    return user?.emailVerified ? this.toPublicUser(user) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    const memberships = this.memberships.get(userId);
    if (!memberships) return [];
    return [...memberships.entries()]
      .map(([workspaceId, role]) => {
        const workspace = this.workspaces.get(workspaceId);
        return workspace ? this.toPublicWorkspace(workspace, role) : null;
      })
      .filter((workspace): workspace is Workspace => Boolean(workspace))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((project) => project.workspaceId && this.canAccessWorkspace(userId, project.workspaceId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProjectForUser(userId: string, projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return project?.workspaceId && this.canAccessWorkspace(userId, project.workspaceId)
      ? project
      : null;
  }

  async createProjectForUser(
    userId: string,
    name: string,
    slug: string,
    apiKey: string
  ): Promise<Project | null> {
    if ([...this.projects.values()].some((project) => project.slug === slug)) return null;
    const workspaceId = this.firstWritableWorkspace(userId);
    if (!workspaceId) return null;
    const project: Project = {
      id: randomUUID(),
      name,
      slug,
      workspaceId,
      createdAt: new Date().toISOString()
    };
    this.projects.set(project.id, project);
    this.projectsByKeyHash.set(this.hashKey(apiKey), project);
    return project;
  }

  async rotateProjectApiKeyForUser(
    userId: string,
    projectId: string,
    apiKey: string
  ): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project?.workspaceId || !this.canWriteWorkspace(userId, project.workspaceId)) return false;
    return this.rotateProjectApiKey(projectId, apiKey);
  }

  async findProjectByApiKey(apiKey: string): Promise<Project | null> {
    return this.projectsByKeyHash.get(this.hashKey(apiKey)) ?? null;
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) ?? null;
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createProject(name: string, slug: string, apiKey: string): Promise<Project> {
    const workspaceId = this.workspaces.values().next().value?.id ?? null;
    const project: Project = {
      id: randomUUID(),
      name,
      slug,
      workspaceId,
      createdAt: new Date().toISOString()
    };
    this.projects.set(project.id, project);
    this.projectsByKeyHash.set(this.hashKey(apiKey), project);
    return project;
  }

  async rotateProjectApiKey(projectId: string, apiKey: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;
    for (const [hash, candidate] of this.projectsByKeyHash) {
      if (candidate.id === projectId) this.projectsByKeyHash.delete(hash);
    }
    this.projectsByKeyHash.set(this.hashKey(apiKey), project);
    return true;
  }

  async recordEvent(
    project: Project,
    event: CapturedEvent,
    fingerprint: string,
    culprit: string | null
  ): Promise<RecordEventResult> {
    const existing = [...this.issues.values()].find(
      (issue) => issue.projectId === project.id && issue.fingerprint === fingerprint
    );
    const occurredAt = event.timestamp;

    let issue: InternalIssue;
    let transition: AlertKind | null = null;
    if (existing) {
      existing.occurrenceCount += 1;
      existing.lastSeen = occurredAt;
      existing.latestRelease = event.release ?? existing.latestRelease;
      existing.latestEnvironment = event.environment ?? existing.latestEnvironment;
      if (existing.status === "resolved") {
        existing.status = "regressed";
        transition = "regression";
      }
      if (event.userId) existing.userIds.add(event.userId);
      existing.affectedUsers = existing.userIds.size;
      issue = existing;
    } else {
      transition = "new_issue";
      const userIds = new Set<string>(event.userId ? [event.userId] : []);
      issue = {
        id: randomUUID(),
        projectId: project.id,
        fingerprint,
        title: event.message,
        errorType: event.type,
        culprit,
        status: "unresolved",
        occurrenceCount: 1,
        affectedUsers: userIds.size,
        firstSeen: occurredAt,
        lastSeen: occurredAt,
        latestRelease: event.release ?? null,
        latestEnvironment: event.environment ?? null,
        userIds
      };
      this.issues.set(issue.id, issue);
    }

    const storedEvent: StoredEvent = {
      ...event,
      id: randomUUID(),
      issueId: issue.id,
      createdAt: new Date().toISOString()
    };
    const issueEvents = this.events.get(issue.id) ?? [];
    issueEvents.unshift(storedEvent);
    this.events.set(issue.id, issueEvents.slice(0, 100));
    return { issue: this.toPublicIssue(issue), transition };
  }

  async listIssues(projectId: string, status?: IssueStatus): Promise<Issue[]> {
    return [...this.issues.values()]
      .filter((issue) => issue.projectId === projectId && (!status || issue.status === status))
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
      .map((issue) => this.toPublicIssue(issue));
  }

  async getIssue(projectId: string, issueId: string): Promise<IssueDetails | null> {
    const issue = this.issues.get(issueId);
    if (!issue || issue.projectId !== projectId) return null;
    return { ...this.toPublicIssue(issue), events: this.events.get(issueId) ?? [] };
  }

  async updateIssueStatus(
    projectId: string,
    issueId: string,
    status: Exclude<IssueStatus, "regressed">
  ): Promise<Issue | null> {
    const issue = this.issues.get(issueId);
    if (!issue || issue.projectId !== projectId) return null;
    issue.status = status;
    return this.toPublicIssue(issue);
  }

  async getStats(projectId: string): Promise<ProjectStats> {
    const issues = [...this.issues.values()].filter((issue) => issue.projectId === projectId);
    const today = new Date().toISOString().slice(0, 10);
    const allEvents = [...this.events.values()].flat();
    const userIds = new Set(
      allEvents
        .filter((event) => this.issues.get(event.issueId)?.projectId === projectId)
        .map((event) => event.userId)
        .filter((userId): userId is string => Boolean(userId))
    );
    return {
      totalEvents: issues.reduce((sum, issue) => sum + issue.occurrenceCount, 0),
      unresolvedIssues: issues.filter(
        (issue) => issue.status === "unresolved" || issue.status === "regressed"
      ).length,
      affectedUsers: userIds.size,
      eventsToday: allEvents.filter(
        (event) =>
          this.issues.get(event.issueId)?.projectId === projectId &&
          event.timestamp.startsWith(today)
      ).length
    };
  }

  async createAlert(
    projectId: string,
    issueId: string,
    kind: AlertKind,
    title: string,
    message: string
  ): Promise<Alert> {
    const alert: Alert = {
      id: randomUUID(),
      projectId,
      issueId,
      kind,
      title,
      message,
      createdAt: new Date().toISOString(),
      deliveryStatus: "stored"
    };
    this.alerts.set(alert.id, alert);
    return alert;
  }

  async updateAlertDelivery(alertId: string, status: AlertDeliveryStatus): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (alert) alert.deliveryStatus = status;
  }

  async listAlerts(projectId: string, limit = 20): Promise<Alert[]> {
    return [...this.alerts.values()]
      .filter((alert) => alert.projectId === projectId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async close(): Promise<void> {}

  private addMembership(userId: string, workspaceId: string, role: WorkspaceRole): void {
    const memberships = this.memberships.get(userId) ?? new Map<string, WorkspaceRole>();
    memberships.set(workspaceId, role);
    this.memberships.set(userId, memberships);
  }

  private canAccessWorkspace(userId: string, workspaceId: string): boolean {
    return this.memberships.get(userId)?.has(workspaceId) ?? false;
  }

  private canWriteWorkspace(userId: string, workspaceId: string): boolean {
    const role = this.memberships.get(userId)?.get(workspaceId);
    return role === "owner" || role === "developer";
  }

  private firstWritableWorkspace(userId: string): string | null {
    const entry = [...(this.memberships.get(userId)?.entries() ?? [])].find(
      ([, role]) => role === "owner" || role === "developer"
    );
    return entry?.[0] ?? null;
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private toPublicUser(user: UserWithPassword): User {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }

  private toPublicWorkspace(workspace: InternalWorkspace, role: WorkspaceRole): Workspace {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
      createdAt: workspace.createdAt
    };
  }

  private toPublicIssue(issue: InternalIssue): Issue {
    const { userIds: _userIds, ...publicIssue } = issue;
    return publicIssue;
  }
}
