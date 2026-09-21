import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { DesktopSpec, DesktopSpecDetails } from '@astra/contracts';

const nextStates: Record<string, string[]> = {
  DRAFT: ['REQUIREMENTS_READY'],
  REQUIREMENTS_READY: ['DESIGN_READY'],
  DESIGN_READY: ['TASKS_READY'],
  TASKS_READY: ['APPROVED'],
  APPROVED: ['RUNNING'],
  RUNNING: ['PAUSED', 'REVIEW', 'VERIFYING'],
  PAUSED: ['RUNNING'],
  REVIEW: ['VERIFYING'],
  VERIFYING: ['COMPLETED'],
  FAILED: ['RUNNING'],
};
const visibleEventFields = [
  'status',
  'title',
  'taskId',
  'from',
  'to',
  'category',
  'agentId',
  'reason',
];

function pretty(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^| )\S/g, (letter) => letter.toUpperCase());
}
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
function summary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  return visibleEventFields
    .filter((key) => key in record)
    .map((key) => `${pretty(key)}: ${String(record[key])}`)
    .join(' · ');
}

export function SpecsWorkspace(props: {
  authenticated: boolean;
  specs: DesktopSpec[];
  selected: DesktopSpecDetails | null;
  error: string | null;
  onSelect: (specId: string) => void;
  onCreate: (input: { title: string; slug: string; objective: string }) => void;
  onUpdate: (input: {
    requirements?: DesktopSpec['requirements'];
    design?: DesktopSpec['design'];
  }) => void;
  onTransition: (to: string) => void;
}): ReactElement {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [tab, setTab] = useState<'requirements' | 'design' | 'tasks' | 'verification'>(
    'requirements',
  );
  const availableTransitions = useMemo(
    () => (props.selected ? (nextStates[props.selected.spec.status] ?? []) : []),
    [props.selected],
  );
  useEffect(() => {
    if (props.selected) setTab('requirements');
  }, [props.selected?.spec.id]);
  if (!props.authenticated)
    return (
      <section className="specs-shell">
        <div className="panel specs-empty">
          <span className="empty-mark">S</span>
          <h2>Sign in to use Specs</h2>
          <p className="muted">
            Specs persist with your Astra account and remain available after a desktop restart.
          </p>
        </div>
      </section>
    );
  return (
    <section className="specs-shell">
      <div className="specs-heading">
        <div>
          <p className="section-kicker">Astra Specs</p>
          <h1>Turn intent into verified work.</h1>
          <p className="muted">
            Requirements, design, tasks, agents, and evidence stay together in one persisted
            workspace.
          </p>
        </div>
        <div className="spec-create panel">
          <input
            aria-label="Spec title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New Spec title"
          />
          <textarea
            aria-label="Spec objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="What should Astra deliver?"
          />
          <button
            className="primary"
            disabled={!title.trim() || !objective.trim()}
            onClick={() => {
              props.onCreate({
                title: title.trim(),
                slug: slugify(title),
                objective: objective.trim(),
              });
              setTitle('');
              setObjective('');
            }}
          >
            Generate Spec
          </button>
        </div>
      </div>
      <div className="specs-layout">
        <aside className="panel spec-list" aria-label="Persisted Specs">
          <div className="panel-heading">
            <div>
              <span className="result-kicker">PROJECT SPECS</span>
              <h2>{props.specs.length} saved</h2>
            </div>
          </div>
          {props.specs.length === 0 ? (
            <p className="muted">Create the first Spec to start a governed workflow.</p>
          ) : (
            props.specs.map((spec) => (
              <button
                className={`spec-list-item ${props.selected?.spec.id === spec.id ? 'active' : ''}`}
                key={spec.id}
                onClick={() => props.onSelect(spec.id)}
              >
                <strong>{spec.title}</strong>
                <span>{pretty(spec.status)}</span>
                <small>{new Date(spec.updatedAt).toLocaleString()}</small>
              </button>
            ))
          )}
        </aside>
        {props.selected ? (
          <div className="spec-detail">
            <div className="panel spec-overview">
              <div>
                <span className="result-kicker">SPEC OVERVIEW</span>
                <h2>{props.selected.spec.title}</h2>
                <p className="muted">{props.selected.spec.requirements.objective}</p>
              </div>
              <div className="spec-status-block">
                <span className={`spec-status status-${props.selected.spec.status.toLowerCase()}`}>
                  {pretty(props.selected.spec.status)}
                </span>
                <span className="muted">
                  v{props.selected.spec.version} · updated{' '}
                  {new Date(props.selected.spec.updatedAt).toLocaleString()}
                </span>
                <div className="spec-actions">
                  {availableTransitions.map((to) => (
                    <button className="secondary" key={to} onClick={() => props.onTransition(to)}>
                      {to === 'RUNNING' ? 'Start execution' : `Move to ${pretty(to)}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="spec-tabs" role="tablist">
              {(['requirements', 'design', 'tasks', 'verification'] as const).map((item) => (
                <button
                  role="tab"
                  aria-selected={tab === item}
                  className={tab === item ? 'active' : ''}
                  key={item}
                  onClick={() => setTab(item)}
                >
                  {pretty(item)}
                </button>
              ))}
            </div>
            {tab === 'requirements' && (
              <RequirementsPanel spec={props.selected.spec} onSave={props.onUpdate} />
            )}
            {tab === 'design' && <DesignPanel spec={props.selected.spec} onSave={props.onUpdate} />}
            {tab === 'tasks' && <TasksPanel details={props.selected} />}
            {tab === 'verification' && <VerificationPanel details={props.selected} />}
          </div>
        ) : (
          <div className="panel specs-empty">
            <span className="empty-mark">↗</span>
            <h2>Select a Spec</h2>
            <p className="muted">The complete persisted workflow will appear here.</p>
          </div>
        )}
      </div>
      {props.error && (
        <div className="error-banner" role="alert">
          {props.error}
        </div>
      )}
    </section>
  );
}

function RequirementsPanel({
  spec,
  onSave,
}: {
  spec: DesktopSpec;
  onSave: (input: { requirements?: DesktopSpec['requirements'] }) => void;
}): ReactElement {
  const [objective, setObjective] = useState(spec.requirements.objective);
  useEffect(() => setObjective(spec.requirements.objective), [spec.id, spec.version]);
  const groups: Array<[string, string[]]> = [
    ['User stories', spec.requirements.userStories],
    ['Functional requirements', spec.requirements.functional],
    ['Non-functional requirements', spec.requirements.nonFunctional],
    ['Security requirements', spec.requirements.security],
    ['Compatibility', spec.requirements.compatibility],
    ['Acceptance criteria', spec.requirements.acceptanceCriteria],
    ['Non-goals', spec.requirements.nonGoals],
  ];
  return (
    <div className="spec-content-grid">
      <div className="panel spec-objective">
        <span className="result-kicker">OBJECTIVE</span>
        <textarea value={objective} onChange={(event) => setObjective(event.target.value)} />
        <button
          className="secondary"
          disabled={!objective.trim() || objective === spec.requirements.objective}
          onClick={() =>
            onSave({ requirements: { ...spec.requirements, objective: objective.trim() } })
          }
        >
          Save objective
        </button>
      </div>
      {groups.map(([label, values]) => (
        <div className="panel spec-section" key={label}>
          <h3>{label}</h3>
          {values.length ? (
            <ul>
              {values.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Not defined yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
function DesignPanel({
  spec,
  onSave,
}: {
  spec: DesktopSpec;
  onSave: (input: { design?: DesktopSpec['design'] }) => void;
}): ReactElement {
  const [architecture, setArchitecture] = useState(spec.design.architecture);
  useEffect(() => setArchitecture(spec.design.architecture), [spec.id, spec.version]);
  const groups: Array<[string, string | string[]]> = [
    ['Architecture', spec.design.architecture],
    ['Components', spec.design.components],
    ['API changes', spec.design.apiChanges],
    ['Data model', spec.design.dataModel],
    ['Flows', spec.design.flows],
    ['Authorization', spec.design.authorization],
    ['Security', spec.design.security],
    ['Failure handling', spec.design.failureModes],
    ['Testing', spec.design.testing],
    ['Deployment and rollback', [...spec.design.migrations, ...spec.design.rollback]],
  ];
  return (
    <div className="spec-content-grid">
      {groups.map(([label, value]) => (
        <div className="panel spec-section" key={label}>
          <h3>{label}</h3>
          {label === 'Architecture' ? (
            <>
              <textarea
                value={architecture}
                onChange={(event) => setArchitecture(event.target.value)}
              />
              <button
                className="secondary"
                disabled={architecture === spec.design.architecture}
                onClick={() => onSave({ design: { ...spec.design, architecture } })}
              >
                Save architecture
              </button>
            </>
          ) : Array.isArray(value) ? (
            value.length ? (
              <ul>
                {value.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">Not defined yet.</p>
            )
          ) : (
            <p>{value || 'Not defined yet.'}</p>
          )}
        </div>
      ))}
    </div>
  );
}
function TasksPanel({ details }: { details: DesktopSpecDetails }): ReactElement {
  const statuses = ['READY', 'RUNNING', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'PENDING'];
  return (
    <div className="spec-tasks-layout">
      <div className="spec-task-board">
        {statuses.map((status) => {
          const tasks = details.tasks.filter((task) => task.status === status);
          return (
            <div className="panel task-lane" key={status}>
              <div className="task-lane-heading">
                <h3>{pretty(status)}</h3>
                <span>{tasks.length}</span>
              </div>
              {tasks.length ? (
                tasks.map((task) => (
                  <article className="task-card" key={task.id}>
                    <strong>{task.title}</strong>
                    <small>
                      {task.id} · {pretty(task.ownerAgentRole)}
                    </small>
                    <p>{task.description || 'No description.'}</p>
                    <span className="task-deps">
                      {task.dependencies.length
                        ? `Depends on ${task.dependencies.join(', ')}`
                        : 'No dependencies · ready to parallelize'}
                    </span>
                    <span className="task-meta">
                      {task.assignedAgentId ?? 'Unassigned'} · {task.verificationStatus}
                    </span>
                  </article>
                ))
              ) : (
                <p className="muted">Empty</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="panel spec-activity">
        <span className="result-kicker">ACTIVITY</span>
        <h3>Agent timeline</h3>
        {details.events.length ? (
          details.events
            .slice(-12)
            .reverse()
            .map((event, index) => (
              <div className="activity-row" key={String(event.id ?? index)}>
                <span className="activity-dot" />
                <div>
                  <strong>{pretty(String(event.kind ?? 'event'))}</strong>
                  <small>{String(event.createdAt ?? '')}</small>
                  <p>{summary(event.payload)}</p>
                </div>
              </div>
            ))
        ) : (
          <p className="muted">Agent activity will appear as tasks run.</p>
        )}
      </div>
    </div>
  );
}
function VerificationPanel({ details }: { details: DesktopSpecDetails }): ReactElement {
  const evidence = details.events.filter((event) =>
    String(event.kind ?? '').startsWith('verification'),
  );
  return (
    <div className="spec-content-grid">
      <div className="panel verification-summary">
        <span className={`spec-status ${details.verified ? 'status-completed' : 'status-pending'}`}>
          {details.verified ? 'Verified' : 'Evidence required'}
        </span>
        <h2>{details.spec.verificationState}</h2>
        <p className="muted">
          Completion is based on persisted verification evidence and open review findings, not an
          agent assertion.
        </p>
      </div>
      <div className="panel spec-section">
        <h3>Verification evidence</h3>
        {evidence.length ? (
          evidence.map((event, index) => (
            <div className="evidence-row" key={String(event.id ?? index)}>
              <strong>{summary(event.payload) || 'Verification check'}</strong>
            </div>
          ))
        ) : (
          <p className="muted">No checks recorded yet.</p>
        )}
      </div>
    </div>
  );
}
