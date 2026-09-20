import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  AgentEvent,
  IpcTaskResult,
  ModelCatalogEntry,
  TaskBudget,
  WorkspaceDescriptor,
} from '@lyntar/contracts';
import { deriveProgressRows } from './view-model.js';

type PendingPermission = {
  requestId: string;
  action: string;
  summary?: string | undefined;
  reason?: string | undefined;
  command?: string | undefined;
  risk?: 'sensitive' | 'destructive' | undefined;
};

const defaultBudget: TaskBudget = {
  maxModelCalls: 8,
  maxRepairs: 2,
  maxCommands: 6,
  maxWallTimeMs: 120_000,
  maxEstimatedCostUsd: 1,
};

export function App(): ReactElement {
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<IpcTaskResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const progressRows = useMemo(() => deriveProgressRows(events), [events]);

  useEffect(() => {
    void window.lyntar.models
      .list()
      .then((nextModels) => {
        setModels(nextModels);
        setSelectedModelId(nextModels[0]?.modelId ?? '');
      })
      .catch(() => setModels([]));
    return window.lyntar.events.subscribe((event) => {
      setEvents((current) => [...current, event]);
      if (event.type === 'permission.requested') setPendingPermission(event.payload);
    });
  }, []);

  async function openWorkspace(): Promise<void> {
    const opened = await window.lyntar.workspace.open();
    if (opened) setWorkspace(opened);
  }

  async function startTask(): Promise<void> {
    if (!workspace || !prompt.trim() || !selectedModelId) return;
    const nextTaskId = crypto.randomUUID();
    setTaskId(nextTaskId);
    setResult(null);
    setEvents([]);
    try {
      const taskResult = await window.lyntar.agent.startTask({
        taskId: nextTaskId,
        prompt: prompt.trim(),
        modelId: selectedModelId,
        budget: defaultBudget,
      });
      setResult(taskResult);
    } finally {
      setTaskId(null);
      setPendingPermission(null);
    }
  }

  async function stopTask(): Promise<void> {
    if (taskId) await window.lyntar.agent.cancelTask(taskId);
  }

  async function resolvePermission(approved: boolean): Promise<void> {
    if (!taskId || !pendingPermission) return;
    if (approved) await window.lyntar.agent.approveAction(taskId, pendingPermission.requestId);
    else await window.lyntar.agent.rejectAction(taskId, pendingPermission.requestId);
    setPendingPermission(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="brand">LYNTAR</span>
          <span className="tagline">The AI development workspace</span>
        </div>
        <div className="model-pill">
          {models.find((model) => model.modelId === selectedModelId)?.displayName ??
            'No server model configured'}
        </div>
      </header>
      <section className="workspace-card">
        <div>
          <p className="eyebrow">LOCAL WORKSPACE</p>
          <h1>{workspace?.displayName ?? 'Open a repository to begin'}</h1>
          <p className="muted">
            {workspace?.canonicalRoot ?? 'Your repository stays on this computer.'}
          </p>
        </div>
        <button onClick={() => void openWorkspace()}>Open repository</button>
      </section>
      <section className="task-grid">
        <div className="panel task-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">BUILD</p>
              <h2>Give Lyntar a task</h2>
            </div>
            <span className="budget">8 model calls · 2 repairs</span>
          </div>
          {models.length > 1 && (
            <label className="model-select">
              Model
              <select
                value={selectedModelId}
                onChange={(event) => setSelectedModelId(event.target.value)}
              >
                {models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Fix the failing validation test without changing the test."
          />
          <div className="actions">
            <button
              className="primary"
              disabled={!workspace || !prompt.trim() || !selectedModelId || Boolean(taskId)}
              onClick={() => void startTask()}
            >
              Start task
            </button>
            <button className="secondary" disabled={!taskId} onClick={() => void stopTask()}>
              Stop
            </button>
          </div>
          {pendingPermission && (
            <div className="permission">
              <strong>
                {pendingPermission.risk === 'destructive'
                  ? 'High-risk approval needed'
                  : 'Approval needed'}
              </strong>
              <span>{pendingPermission.summary ?? pendingPermission.action}</span>
              {pendingPermission.command && <code>{pendingPermission.command}</code>}
              {pendingPermission.reason && (
                <span className="muted">{pendingPermission.reason}</span>
              )}
              <div>
                <button className="primary" onClick={() => void resolvePermission(true)}>
                  Allow
                </button>
                <button className="secondary" onClick={() => void resolvePermission(false)}>
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="panel progress-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EXECUTION</p>
              <h2>What Lyntar is doing</h2>
            </div>
          </div>
          <div className="progress-list">
            {progressRows.length === 0 ? (
              <p className="muted">Progress will appear here.</p>
            ) : (
              progressRows.map((row) => (
                <div className="progress-row" key={row.eventId}>
                  <span className="dot" />
                  {row.label}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
      {result && (
        <section className="panel result-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">RESULT</p>
              <h2>{result.summary}</h2>
            </div>
            <span className={`status ${result.state.toLowerCase()}`}>{result.state}</span>
          </div>
          <p className="muted">{result.verification.summary}</p>
          <p className="muted">
            {result.usageSummary.requestCount} model request
            {result.usageSummary.requestCount === 1 ? '' : 's'}
            {result.usageSummary.actualCostUsd === null
              ? ' · provider cost unavailable'
              : ` · provider cost $${result.usageSummary.actualCostUsd.toFixed(6)}`}
          </p>
          <div className="diff-grid">
            <div>
              <h3>Lyntar changes</h3>
              <ul>
                {result.gitDiff.lyntarPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Pre-existing changes</h3>
              <ul>
                {result.gitDiff.preExistingPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </div>
          </div>
          <details>
            <summary>Usage receipts</summary>
            <pre>{JSON.stringify(result.usageReceipts, null, 2)}</pre>
          </details>
        </section>
      )}
    </main>
  );
}
