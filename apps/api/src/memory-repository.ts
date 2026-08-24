import { createHash, randomUUID } from "node:crypto";
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

interface InternalIssue extends Issue {
  userIds: Set<string>;
}

export class MemoryIssueRepository implements IssueRepository {
  readonly storageName = "memory";
  private readonly projectsByKeyHash = new Map<string, Project>();
  private readonly projects = new Map<string, Project>();
  private readonly issues = new Map<string, InternalIssue>();
  private readonly events = new Map<string, StoredEvent[]>();
  private readonly alerts = new Map<string, Alert>();

  constructor(private readonly demoApiKey: string) {}

  async initialize(): Promise<void> {
    const project: Project = {
      id: "demo-project",
      name: "Demo Shopping Website",
      slug: "cartly-shop",
      createdAt: new Date().toISOString()
    };
    this.projects.set(project.id, project);
    this.projectsByKeyHash.set(this.hashKey(this.demoApiKey), project);
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
    const project: Project = {
      id: randomUUID(),
      name,
      slug,
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
      if (event.userId) {
        existing.userIds.add(event.userId);
      }
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
    if (!issue || issue.projectId !== projectId) {
      return null;
    }

    return {
      ...this.toPublicIssue(issue),
      events: this.events.get(issueId) ?? []
    };
  }

  async updateIssueStatus(
    projectId: string,
    issueId: string,
    status: Exclude<IssueStatus, "regressed">
  ): Promise<Issue | null> {
    const issue = this.issues.get(issueId);
    if (!issue || issue.projectId !== projectId) {
      return null;
    }
    issue.status = status;
    return this.toPublicIssue(issue);
  }

  async getStats(projectId: string): Promise<ProjectStats> {
    const issues = [...this.issues.values()].filter((issue) => issue.projectId === projectId);
    const today = new Date().toISOString().slice(0, 10);
    const userIds = new Set(
      [...this.events.values()]
        .flat()
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
      eventsToday: [...this.events.values()]
        .flat()
        .filter(
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

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private toPublicIssue(issue: InternalIssue): Issue {
    const { userIds: _userIds, ...publicIssue } = issue;
    return publicIssue;
  }
}
