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
  User,
  UserWithPassword,
  Workspace
} from "./domain.js";

export interface IssueRepository {
  readonly storageName: string;
  initialize(): Promise<void>;
  ensureBootstrapIdentity(input: {
    name: string;
    email: string;
    passwordHash: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<void>;
  findUserByEmail(email: string): Promise<UserWithPassword | null>;
  createUserWithWorkspace(input: {
    name: string;
    email: string;
    passwordHash: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<{ user: User; workspace: Workspace } | null>;
  storeAuthToken(input: {
    userId: string;
    kind: "verify_email" | "reset_password";
    tokenHash: string;
    expiresAt: string;
  }): Promise<void>;
  verifyEmailWithToken(tokenHash: string, now: string): Promise<User | null>;
  resetPasswordWithToken(
    tokenHash: string,
    passwordHash: string,
    now: string
  ): Promise<User | null>;
  createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void>;
  getSessionUser(tokenHash: string, now: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
  listWorkspacesForUser(userId: string): Promise<Workspace[]>;
  listProjectsForUser(userId: string): Promise<Project[]>;
  getProjectForUser(userId: string, projectId: string): Promise<Project | null>;
  createProjectForUser(
    userId: string,
    name: string,
    slug: string,
    apiKey: string
  ): Promise<Project | null>;
  rotateProjectApiKeyForUser(userId: string, projectId: string, apiKey: string): Promise<boolean>;
  findProjectByApiKey(apiKey: string): Promise<Project | null>;
  getProject(projectId: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  createProject(name: string, slug: string, apiKey: string): Promise<Project>;
  rotateProjectApiKey(projectId: string, apiKey: string): Promise<boolean>;
  recordEvent(
    project: Project,
    event: CapturedEvent,
    fingerprint: string,
    culprit: string | null
  ): Promise<RecordEventResult>;
  listIssues(projectId: string, status?: IssueStatus): Promise<Issue[]>;
  getIssue(projectId: string, issueId: string): Promise<IssueDetails | null>;
  updateIssueStatus(
    projectId: string,
    issueId: string,
    status: Exclude<IssueStatus, "regressed">
  ): Promise<Issue | null>;
  getStats(projectId: string): Promise<ProjectStats>;
  createAlert(
    projectId: string,
    issueId: string,
    kind: AlertKind,
    title: string,
    message: string
  ): Promise<Alert>;
  updateAlertDelivery(alertId: string, status: AlertDeliveryStatus): Promise<void>;
  listAlerts(projectId: string, limit?: number): Promise<Alert[]>;
  close(): Promise<void>;
}
