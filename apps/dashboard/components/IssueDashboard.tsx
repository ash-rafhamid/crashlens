"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type IssueStatus = "unresolved" | "resolved" | "ignored" | "regressed";

interface Issue {
  id: string;
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

interface EventRecord {
  id: string;
  message: string;
  stack?: string;
  timestamp: string;
  release?: string;
  environment?: string;
  url?: string;
  userAgent?: string;
  browser?: {
    name: string;
    version?: string;
    engine: string;
    operatingSystem: string;
    deviceType: "Desktop" | "Mobile" | "Tablet";
  };
  userId?: string;
  context?: Record<string, unknown>;
  breadcrumbs?: Array<{ type: string; message: string; timestamp: string }>;
}

interface IssueDetails extends Issue {
  events: EventRecord[];
}

interface Stats {
  totalEvents: number;
  unresolvedIssues: number;
  affectedUsers: number;
  eventsToday: number;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface AlertRecord {
  id: string;
  issueId: string;
  kind: "new_issue" | "regression";
  title: string;
  message: string;
  createdAt: string;
  deliveryStatus: "stored" | "delivered" | "failed";
}

const emptyStats: Stats = { totalEvents: 0, unresolvedIssues: 0, affectedUsers: 0, eventsToday: 0 };

function relativeTime(date: string): string {
  const difference = Date.now() - Date.parse(date);
  const seconds = Math.max(0, Math.floor(difference / 1_000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function IssueDashboard({ userEmail }: { userEmail: string }) {
  const testShopUrl = process.env.NEXT_PUBLIC_DEMO_SHOP_URL ?? "http://localhost:3001/";
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [selected, setSelected] = useState<IssueDetails | null>(null);
  const [filter, setFilter] = useState<"all" | IssueStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectActionPending, setProjectActionPending] = useState(false);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<{ label: string; value: string } | null>(null);
  const [activeSection, setActiveSection] = useState<"issues" | "activity">("issues");
  const [accountOpen, setAccountOpen] = useState(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (window.location.hash === "#alerts") setActiveSection("activity");
  }, []);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/login");
      return;
    }
    if (!response.ok) throw new Error("Could not load projects");
    const body = (await response.json()) as { projects: Project[] };
    setProjects(body.projects);
    if (!body.projects.length) setLoading(false);
    setSelectedProjectId((current) => {
      if (current && body.projects.some((project) => project.id === current)) return current;
      const remembered = window.localStorage.getItem("crashlens-project");
      return body.projects.find((project) => project.id === remembered)?.id ?? body.projects[0]?.id ?? null;
    });
  }, []);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!selectedProjectId) return;
    if (!quiet) setLoading(true);
    try {
      const query = `?projectId=${encodeURIComponent(selectedProjectId)}`;
      const [issuesResponse, statsResponse, alertsResponse] = await Promise.all([
        fetch(`/api/issues${query}`, { cache: "no-store" }),
        fetch(`/api/stats${query}`, { cache: "no-store" }),
        fetch(`/api/alerts${query}`, { cache: "no-store" })
      ]);
      if ([issuesResponse, statsResponse, alertsResponse].some((response) => response.status === 401)) {
        window.location.assign("/login");
        return;
      }
      if (!issuesResponse.ok || !statsResponse.ok || !alertsResponse.ok) {
        const body = (await issuesResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not load the dashboard");
      }
      const issueData = (await issuesResponse.json()) as {
        project: { name: string };
        issues: Issue[];
      };
      const statsData = (await statsResponse.json()) as { stats: Stats };
      const alertData = (await alertsResponse.json()) as { alerts: AlertRecord[] };
      setIssues(issueData.issues);
      setStats(statsData.stats);
      setAlerts(alertData.alerts);
      setError(null);
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the dashboard");
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadProjects().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load projects");
      setLoading(false);
    });
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) return;
    window.localStorage.setItem("crashlens-project", selectedProjectId);
    setSelected(null);
    setIssues([]);
    setStats(emptyStats);
    setAlerts([]);
    void loadDashboard();
    const timer = window.setInterval(() => void loadDashboard(true), 3_000);
    return () => window.clearInterval(timer);
  }, [loadDashboard, selectedProjectId]);

  useEffect(() => {
    if (!accountOpen) return;
    function closeAccountMenu(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest(".account-menu")) setAccountOpen(false);
    }
    function closeAccountMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenuWithKeyboard);
    };
  }, [accountOpen]);

  useEffect(() => {
    const issueId = selected?.id;
    if (!issueId) return;

    let active = true;
    async function refreshOpenIssue() {
      const response = await fetch(
        `/api/issues/${issueId}?projectId=${encodeURIComponent(selectedProjectId ?? "")}`,
        { cache: "no-store" }
      );
      if (!response.ok || !active) return;
      const body = (await response.json()) as { issue: IssueDetails };
      if (active) setSelected(body.issue);
    }

    const timer = window.setInterval(() => void refreshOpenIssue(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selected?.id, selectedProjectId]);

  async function openIssue(issueId: string) {
    if (!selectedProjectId) return;
    const response = await fetch(
      `/api/issues/${issueId}?projectId=${encodeURIComponent(selectedProjectId)}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const body = (await response.json()) as { issue: IssueDetails };
    setSelected(body.issue);
  }

  async function changeStatus(status: "unresolved" | "resolved" | "ignored") {
    if (!selected || !selectedProjectId) return;
    const response = await fetch(
      `/api/issues/${selected.id}?projectId=${encodeURIComponent(selectedProjectId)}`,
      {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
      }
    );
    if (!response.ok) return;
    setSelected({ ...selected, status });
    await loadDashboard(true);
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    setProjectActionPending(true);
    setProjectActionError(null);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newProjectName })
    });
    const body = (await response.json().catch(() => ({}))) as {
      project?: Project;
      apiKey?: string;
      error?: string;
    };
    setProjectActionPending(false);
    if (!response.ok || !body.project || !body.apiKey) {
      setProjectActionError(body.error ?? "Could not create project");
      return;
    }
    setProjects((current) => [...current, body.project!].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedProjectId(body.project.id);
    setNewProjectName("");
    setRevealedKey({ label: `${body.project.name} SDK key`, value: body.apiKey });
  }

  async function rotateKey() {
    if (!selectedProject || !window.confirm(`Rotate the SDK key for ${selectedProject.name}? The old key will stop working immediately.`)) return;
    setProjectActionPending(true);
    setProjectActionError(null);
    const response = await fetch(`/api/projects/${selectedProject.id}/rotate-key`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { apiKey?: string; error?: string };
    setProjectActionPending(false);
    if (!response.ok || !body.apiKey) {
      setProjectActionError(body.error ?? "Could not rotate the key");
      return;
    }
    setRevealedKey({ label: `${selectedProject.name} new SDK key`, value: body.apiKey });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  function showSection(section: "issues" | "activity") {
    if (!selectedProjectId) return;
    setActiveSection(section);
    const targetId = section === "issues" ? "issues" : "alerts";
    window.history.replaceState(null, "", `#${targetId}`);
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const visibleIssues = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return issues.filter((issue) => {
      const matchesStatus = filter === "all" || issue.status === filter;
      const matchesSearch = !query || [issue.title, issue.errorType, issue.culprit, issue.latestRelease]
        .some((value) => value?.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [issues, filter, searchQuery]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="logo" href="#"><span className="logo-mark">C</span><span>CrashLens</span></a>
        <nav className="side-nav">
          <p>Workspace</p>
          <button type="button" className={`nav-button ${activeSection === "issues" ? "active" : ""}`} disabled={!selectedProjectId} onClick={() => showSection("issues")}><span className="nav-dot" /> Issues <b>{stats.unresolvedIssues}</b></button>
          <button type="button" className={`nav-button ${activeSection === "activity" ? "active" : ""}`} disabled={!selectedProjectId} onClick={() => showSection("activity")}><span className="nav-dot" /> Activity <b>{alerts.length}</b></button>
          <p>Configuration</p>
          <button className="nav-button" onClick={() => setSettingsOpen(true)}><span className="nav-dot" /> Project settings</button>
        </nav>
        <div className="project-switcher">
          <i>{selectedProject?.name.slice(0, 2).toUpperCase() ?? "--"}</i>
          <label>
            <span>Current project</span>
            <select
              value={selectedProjectId ?? ""}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              aria-label="Current project"
            >
              {!projects.length && <option value="">No project yet</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <b>Change</b>
        </div>
      </aside>

      <main className="main-content">
        <header>
          <div className="page-heading"><p className="breadcrumb">{selectedProject?.name ?? (loading ? "Loading projects…" : "No project selected")}</p><h1>{selectedProjectId ? "Issues" : "Workspace"}</h1></div>
          <div className="header-actions"><span className="live"><i /> Live</span>{selectedProject?.slug === "cartly-shop" && <a href={testShopUrl} target="_blank" rel="noreferrer">Open demo shop</a>}<div className="account-menu"><button className="avatar" title="Open account menu" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((current) => !current)}>{userEmail.slice(0, 2).toUpperCase()}</button>{accountOpen && <div className="account-popover"><span>Signed in as</span><strong>{userEmail}</strong><button onClick={() => void logout()}>Sign out</button></div>}</div></div>
        </header>

        {error && <div className="connection-error"><strong>API unavailable</strong><span>{error}</span><code>npm run dev</code></div>}

        {!error && !loading && !projects.length && (
          <section className="empty-workspace">
            <span className="empty-workspace-mark">C</span>
            <p>WELCOME TO CRASHLENS</p>
            <h2>Create your first monitored project</h2>
            <p className="empty-workspace-copy">A project gives your website its own SDK key and keeps its errors separate from every other application.</p>
            <button onClick={() => setSettingsOpen(true)}>Create first project</button>
            <div className="onboarding-steps"><span><b>1</b>Create a project</span><span><b>2</b>Add the browser SDK</span><span><b>3</b>Trigger a test error</span></div>
          </section>
        )}

        {!!selectedProjectId && <>

        <section className="health-strip" aria-label="Project health">
          <span><strong>{stats.unresolvedIssues}</strong> unresolved</span>
          <span><strong>{stats.eventsToday.toLocaleString()}</strong> events today</span>
          <span><strong>{stats.affectedUsers.toLocaleString()}</strong> users affected</span>
          <span className="health-note">Auto-refreshing every 3 seconds</span>
        </section>

        <section className="triage-workspace" id="issues">
          <div className="workspace-heading">
            <div><h2>All issues</h2><p>Errors with the same cause are grouped automatically.</p></div>
            <label className="issue-search"><span>Search issues</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search message, file, or release" /></label>
          </div>
          <div className="issue-toolbar">
            <div className="filter-row">
              {(["all", "unresolved", "regressed", "resolved", "ignored"] as const).map((item) => (
                <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}<b>{item === "all" ? issues.length : issues.filter((issue) => issue.status === item).length}</b></button>
              ))}
            </div>
            <span>{updatedAt ? `Updated ${relativeTime(updatedAt.toISOString())}` : "Connecting…"}</span>
          </div>

          <div className="issue-columns"><span>Issue</span><span>Users</span><span>Events</span><span>Release</span><span>Last seen</span></div>
          <div className="issue-list">
            {loading && !issues.length && <div className="empty-state"><div className="spinner"/><h3>Connecting to CrashLens</h3><p>Loading the latest production events…</p></div>}
            {!loading && !visibleIssues.length && <div className="empty-state"><span>0</span><h3>No matching issues</h3><p>Change the filter or search phrase.</p></div>}
            {visibleIssues.map((issue) => (
              <button className={`issue-row ${selected?.id === issue.id ? "open" : ""}`} key={issue.id} onClick={() => void openIssue(issue.id)}>
                <span className={`severity ${issue.status}`} aria-label={issue.status} />
                <span className="issue-main"><strong>{issue.title}</strong><small>{issue.culprit ?? `${issue.errorType} · no stack frame`}</small><span><i className={`status-dot ${issue.status}`}/>{issue.status} · {issue.latestEnvironment ?? "unknown environment"}</span></span>
                <span className="issue-users"><strong>{issue.affectedUsers.toLocaleString()}</strong></span>
                <span className="issue-count"><strong>{issue.occurrenceCount.toLocaleString()}</strong></span>
                <span className="issue-release"><strong>{issue.latestRelease ?? "—"}</strong></span>
                <span className="issue-time"><strong>{relativeTime(issue.lastSeen)}</strong></span>
                <span className="chevron">›</span>
              </button>
            ))}
          </div>
        </section>

        <section className="alerts-panel" id="alerts">
          <div className="activity-heading"><div><h2>Activity</h2><p>New issues and regressions from this project.</p></div><span>{alerts.length} entries</span></div>
          <div className="alert-list">
            {alerts.slice(0, 6).map((alert) => (
              <button key={alert.id} onClick={() => void openIssue(alert.issueId)}>
                <i className={alert.kind} aria-hidden="true" />
                <span><strong>{alert.title}</strong><small>{alert.message}</small></span>
                <em className={alert.deliveryStatus}>{alert.deliveryStatus}</em>
                <time>{relativeTime(alert.createdAt)}</time>
              </button>
            ))}
            {!alerts.length && <div className="alerts-empty">No activity yet.</div>}
          </div>
        </section>
        </>}
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}>
          <section className="project-modal" id="settings">
            <div className="modal-heading"><div><p>PROJECT SETTINGS</p><h2>Projects and SDK keys</h2></div><button aria-label="Close project settings" onClick={() => setSettingsOpen(false)}>×</button></div>
            <div className="current-project-card"><span>Selected project</span><strong>{selectedProject?.name ?? "No project"}</strong><code>{selectedProject?.slug ?? "—"}</code><button disabled={!selectedProject || projectActionPending} onClick={() => void rotateKey()}>Rotate SDK key</button></div>
            <form onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
              <label>New project name<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Example: Banking Portal" minLength={2} maxLength={100} required /></label>
              <button type="submit" disabled={projectActionPending}>{projectActionPending ? "Working…" : "Create project"}</button>
            </form>
            {projectActionError && <div className="project-action-error">{projectActionError}</div>}
            {revealedKey && <div className="secret-card"><p>Copy this now — it is shown only in this browser session.</p><strong>{revealedKey.label}</strong><code>{revealedKey.value}</code><button onClick={() => void navigator.clipboard.writeText(revealedKey.value)}>Copy key</button></div>}
            <div className="sdk-instructions"><strong>Add it to the website you want to monitor:</strong><pre>{`CrashLens.init({\n  apiKey: "${revealedKey?.value ?? "your-project-sdk-key"}",\n  dsn: "https://your-api.example.com"\n});`}</pre><p>The SDK key may be used only to send errors. The private dashboard admin key never goes into a customer website.</p></div>
          </section>
        </div>
      )}

      {selected && (
        <div className="drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <aside className="issue-drawer">
            <div className="drawer-top"><div><span className={`severity ${selected.status}`}>!</span><small>ISSUE {selected.id.slice(0, 8).toUpperCase()}</small></div><button aria-label="Close issue" onClick={() => setSelected(null)}>×</button></div>
            <h2>{selected.title}</h2>
            <p className="drawer-culprit">{selected.culprit ?? "No stack frame was provided"}</p>
            <div className="drawer-actions"><button className="resolve" onClick={() => void changeStatus("resolved")}>Resolve</button><button onClick={() => void changeStatus("unresolved")}>Reopen</button><button onClick={() => void changeStatus("ignored")}>Ignore</button></div>
            <div className="detail-grid"><div><span>Occurrences</span><strong>{selected.occurrenceCount}</strong></div><div><span>Affected users</span><strong>{selected.affectedUsers}</strong></div><div><span>First seen</span><strong>{relativeTime(selected.firstSeen)}</strong></div><div><span>Release</span><strong>{selected.latestRelease ?? "—"}</strong></div></div>

            {selected.events[0] && <>
              <div className="latest-browser-card">
                <div><span>Latest event browser</span><strong>{selected.events[0].browser ? `${selected.events[0].browser.name}${selected.events[0].browser.version ? ` ${selected.events[0].browser.version}` : ""}` : "Legacy event — run a new test"}</strong></div>
                <div><span>System</span><strong>{selected.events[0].browser ? `${selected.events[0].browser.operatingSystem} · ${selected.events[0].browser.deviceType}` : "No browser details"}</strong></div>
                <i>Refreshes every 3 seconds</i>
              </div>
              <section className="event-section"><div className="section-title"><h3>Latest stack trace</h3><span>{new Date(selected.events[0].timestamp).toLocaleString()}</span></div><pre>{selected.events[0].stack ?? `${selected.errorType}: ${selected.title}`}</pre></section>
              <section className="event-section"><div className="section-title"><h3>Event context</h3></div><dl>
                <div><dt>Page</dt><dd>{selected.events[0].url ?? "Not provided"}</dd></div>
                <div><dt>User</dt><dd>{selected.events[0].userId ?? "Anonymous"}</dd></div>
                <div><dt>Browser</dt><dd>{selected.events[0].browser ? `${selected.events[0].browser.name}${selected.events[0].browser.version ? ` ${selected.events[0].browser.version}` : ""}` : "Unknown browser"}</dd></div>
                <div><dt>System</dt><dd>{selected.events[0].browser ? `${selected.events[0].browser.operatingSystem} · ${selected.events[0].browser.deviceType} · ${selected.events[0].browser.engine}` : "Not provided"}</dd></div>
                <div><dt>Raw browser data</dt><dd>{selected.events[0].userAgent ?? "Not provided"}</dd></div>
                {Object.entries(selected.events[0].context ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{displayValue(value)}</dd></div>)}
              </dl></section>
              <section className="event-section"><div className="section-title"><h3>Breadcrumbs</h3><span>Before the error</span></div><div className="breadcrumbs">
                {(selected.events[0].breadcrumbs ?? []).map((crumb, index) => <div key={`${crumb.timestamp}-${index}`}><i/><span>{new Date(crumb.timestamp).toLocaleTimeString()}</span><strong>{crumb.type}</strong><p>{crumb.message}</p></div>)}
                {!selected.events[0].breadcrumbs?.length && <p>No breadcrumbs were captured.</p>}
              </div></section>
              <section className="event-section"><div className="section-title"><h3>Recent event browsers</h3><span>Newest first</span></div><div className="event-history">
                {selected.events.slice(0, 8).map((event, index) => <div key={event.id}><b>{index + 1}</b><span><strong>{event.browser?.name ?? "Legacy / unknown"}</strong><small>{event.browser ? `${event.browser.operatingSystem} · ${event.browser.deviceType}` : "Trigger a fresh event for browser details"}</small></span><time>{relativeTime(event.timestamp)}</time></div>)}
              </div></section>
            </>}
          </aside>
        </div>
      )}
    </div>
  );
}
