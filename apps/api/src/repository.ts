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
  RecordEventResult
} from "./domain.js";

export interface IssueRepository {
  readonly storageName: string;
  initialize(): Promise<void>;
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
