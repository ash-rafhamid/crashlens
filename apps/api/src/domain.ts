export const ISSUE_STATUSES = ["unresolved", "resolved", "ignored", "regressed"] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export type AlertKind = "new_issue" | "regression";
export type AlertDeliveryStatus = "stored" | "delivered" | "failed";

export interface Alert {
  id: string;
  projectId: string;
  issueId: string;
  kind: AlertKind;
  title: string;
  message: string;
  createdAt: string;
  deliveryStatus: AlertDeliveryStatus;
}

export interface Breadcrumb {
  type: string;
  message: string;
  timestamp: string;
}

export interface BrowserInfo {
  name: string;
  version?: string;
  engine: string;
  operatingSystem: string;
  deviceType: "Desktop" | "Mobile" | "Tablet";
}

export interface CapturedEvent {
  type: string;
  message: string;
  stack?: string;
  timestamp: string;
  release?: string;
  environment?: string;
  url?: string;
  userAgent?: string;
  browser?: BrowserInfo;
  userId?: string;
  context?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
}

export interface Issue {
  id: string;
  projectId: string;
  fingerprint: string;
  title: string;
  errorType: string;
  culprit: string | null;
  status: IssueStatus;
  occurrenceCount: number;
  affectedUsers: number;
  firstSeen: string;
  lastSeen: string;
  latestRelease: string | null;
  latestEnvironment: string | null;
}

export interface StoredEvent extends CapturedEvent {
  id: string;
  issueId: string;
  createdAt: string;
}

export interface IssueDetails extends Issue {
  events: StoredEvent[];
}

export interface ProjectStats {
  totalEvents: number;
  unresolvedIssues: number;
  affectedUsers: number;
  eventsToday: number;
}

export interface RecordEventResult {
  issue: Issue;
  transition: AlertKind | null;
}
