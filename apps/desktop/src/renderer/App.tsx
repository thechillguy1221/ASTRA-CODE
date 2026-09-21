import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type {
  AgentEvent,
  DesktopDevice,
  DesktopRoom,
  DesktopRoomFile,
  DesktopRoomFileImport,
  HackathonPlan,
  IpcTaskResult,
  LearnDepth,
  LearnResult,
  ModelCatalogEntry,
  PublicUser,
  TaskBudget,
  VivaDifficulty,
  VivaEvaluation,
  VivaQuestion,
  WorkspaceDescriptor,
  Wallet,
} from '@lyntar/contracts';
import { addCredits } from '@lyntar/billing/math';
import { AstraClineApprovalCard, AstraClineSessionStatus } from './cline-workspace.js';
import { deriveProgressRows } from './view-model.js';

type PendingPermission = {
  requestId: string;
  action: string;
  summary?: string | undefined;
  reason?: string | undefined;
  command?: string | undefined;
  risk?: 'sensitive' | 'destructive' | undefined;
};

type ViewId = 'build' | 'learn' | 'viva' | 'hackathon' | 'projects' | 'extensions' | 'settings';

const defaultBudget: TaskBudget = {
  maxModelCalls: 8,
  maxRepairs: 2,
  maxCommands: 6,
  maxWallTimeMs: 120_000,
  // Free-plan-safe starting ceiling: $0.25 = 25 credits under the
  // server-authoritative $0.01-per-credit rule. Higher plans can later expose
  // a server-provided per-task budget without changing the IPC contract.
  maxEstimatedCostUsd: 0.25,
  overrunAllowanceUsd: 0.15,
  maxCostCheckpoints: 2,
};

const navItems: Array<{ id: ViewId; label: string; hint: string }> = [
  { id: 'build', label: 'Build', hint: 'Make changes safely' },
  { id: 'learn', label: 'Learn', hint: 'Understand your project' },
  { id: 'viva', label: 'Viva', hint: 'Practice with your code' },
  { id: 'hackathon', label: 'Hackathon', hint: 'Shape a credible MVP' },
  { id: 'projects', label: 'Projects', hint: 'Open a local repository' },
  { id: 'extensions', label: 'Extensions', hint: 'Skills and tools' },
  { id: 'settings', label: 'Settings', hint: 'Preferences and status' },
];

const essentials = [
  ['Ponytail', 'AUTO', 'Smallest sufficient implementation'],
  ['Frontend Design', 'AUTO', 'Design-system-aware interfaces'],
  ['UI/UX Quality', 'AUTO', 'Clear interaction and accessibility states'],
  ['Verification', 'ON', 'Evidence before completion claims'],
  ['Security Review', 'AUTO', 'Focused review for sensitive boundaries'],
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export function App(): ReactElement {
  const [view, setView] = useState<ViewId>('build');
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<IpcTaskResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learnPath, setLearnPath] = useState('');
  const [learnDepth, setLearnDepth] = useState<LearnDepth>('BEGINNER');
  const [learnQuestion, setLearnQuestion] = useState('');
  const [learnResult, setLearnResult] = useState<LearnResult | null>(null);
  const [vivaDifficulty, setVivaDifficulty] = useState<VivaDifficulty>('INTERMEDIATE');
  const [vivaQuestions, setVivaQuestions] = useState<VivaQuestion[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [vivaAnswer, setVivaAnswer] = useState('');
  const [vivaEvaluation, setVivaEvaluation] = useState<VivaEvaluation | null>(null);
  const [hackathonProblem, setHackathonProblem] = useState('');
  const [hackathonCriteria, setHackathonCriteria] = useState('working demo, clear user value');
  const [hackathonPlan, setHackathonPlan] = useState<HackathonPlan | null>(null);
  const [authUser, setAuthUser] = useState<PublicUser | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [devices, setDevices] = useState<DesktopDevice[]>([]);
  const [rooms, setRooms] = useState<DesktopRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [roomFiles, setRoomFiles] = useState<DesktopRoomFile[]>([]);
  const [roomImport, setRoomImport] = useState<DesktopRoomFileImport | null>(null);
  const [importDestinations, setImportDestinations] = useState<Record<string, string>>({});
  const [observedCredits, setObservedCredits] = useState('0');
  const progressRows = useMemo(() => deriveProgressRows(events), [events]);
  const selectedQuestion = vivaQuestions.find((question) => question.id === selectedQuestionId);
  const selectedModel = models.find((model) => model.modelId === selectedModelId);

  useEffect(() => {
    if (!selectedRoomId) {
      setRoomFiles([]);
      setRoomImport(null);
      return;
    }
    void window.lyntar.rooms
      .listFiles(selectedRoomId)
      .then(setRoomFiles)
      .catch((fileError: unknown) => setError(errorMessage(fileError)));
  }, [selectedRoomId]);

  useEffect(() => {
    void window.lyntar.models
      .list()
      .then((nextModels) => {
        setModels(nextModels);
        setSelectedModelId(nextModels.length > 0 ? 'AUTO' : '');
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError)));
    void window.lyntar.auth
      .status()
      .then((user) => {
        setAuthUser(user);
        if (user)
          void Promise.all([
            window.lyntar.billing.wallet(),
            window.lyntar.devices.list(),
            window.lyntar.rooms.list(),
          ])
            .then(([nextWallet, nextDevices, nextRooms]) => {
              setWallet(nextWallet);
              setDevices(nextDevices);
              setRooms(nextRooms);
            })
            .catch(() => {
              setWallet(null);
              setDevices([]);
              setRooms([]);
            });
      })
      .catch((authError: unknown) => setError(errorMessage(authError)));
    return window.lyntar.events.subscribe((event) => {
      setEvents((current) => [...current, event]);
      if (event.type === 'permission.requested') setPendingPermission(event.payload);
      if (event.type === 'usage.received' && event.payload.creditsUsed)
        setObservedCredits((current) => addCredits(current, event.payload.creditsUsed ?? '0'));
    });
  }, []);

  useEffect(() => {
    return window.lyntar.auth.onGoogleCallback((code) => {
      void window.lyntar.auth
        .googleComplete(code)
        .then((user) => {
          setAuthUser(user);
          return Promise.all([
            window.lyntar.billing.wallet(),
            window.lyntar.devices.list(),
            window.lyntar.rooms.list(),
          ]);
        })
        .then(([nextWallet, nextDevices, nextRooms]) => {
          setWallet(nextWallet);
          setDevices(nextDevices);
          setRooms(nextRooms);
        })
        .catch((authError: unknown) => setError(errorMessage(authError)));
    });
  }, []);

  async function signIn(): Promise<void> {
    try {
      setError(null);
      const user = await window.lyntar.auth.login({
        email: authEmail.trim(),
        password: authPassword,
        device: {
          label: 'Astra Code desktop',
          platform: 'win32',
          architecture: 'x64',
          appVersion: '0.1.0',
        },
      });
      setAuthUser(user);
      setWallet(await window.lyntar.billing.wallet());
      setDevices(await window.lyntar.devices.list());
      setRooms(await window.lyntar.rooms.list());
      setAuthPassword('');
    } catch (authError) {
      setError(errorMessage(authError));
    }
  }

  async function signOut(): Promise<void> {
    await window.lyntar.auth.logout();
    setAuthUser(null);
    setWallet(null);
    setDevices([]);
    setRooms([]);
    setSelectedRoomId('');
    setRoomFiles([]);
    setRoomImport(null);
  }

  async function signInGoogle(): Promise<void> {
    try {
      setError(null);
      await window.lyntar.auth.googleStart();
      setError(
        'Google opened in your system browser. Return through the Astra callback to finish sign-in.',
      );
    } catch (authError) {
      setError(errorMessage(authError));
    }
  }

  async function openWorkspace(): Promise<void> {
    try {
      setError(null);
      const opened = await window.lyntar.workspace.open();
      if (opened) setWorkspace(opened);
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  async function startTask(): Promise<void> {
    if (!workspace || !prompt.trim() || !selectedModelId) return;
    const selectedRoom = rooms.find((room) => room.id === selectedRoomId);
    if (selectedRoom) {
      if (selectedRoom.hostAvailability !== 'ONLINE') {
        setError(
          `Room host is ${selectedRoom.hostAvailability.toLowerCase()}. Select an online host before starting.`,
        );
        return;
      }
      if (!devices.some((device) => device.id === selectedRoom.hostDeviceId)) {
        setError(
          'This Room is hosted on another device. Remote host execution is not connected to this desktop session.',
        );
        return;
      }
    }
    const nextTaskId = crypto.randomUUID();
    setTaskId(nextTaskId);
    setResult(null);
    setError(null);
    setEvents([]);
    setObservedCredits('0');
    try {
      const taskResult = await window.lyntar.agent.startTask({
        taskId: nextTaskId,
        prompt: prompt.trim(),
        modelId: selectedModelId,
        ...(selectedRoomId ? { roomId: selectedRoomId } : {}),
        budget: defaultBudget,
      });
      setResult(taskResult);
    } catch (taskError) {
      setError(errorMessage(taskError));
    } finally {
      setTaskId(null);
      setPendingPermission(null);
    }
  }

  async function uploadRoomFile(intent: 'REFERENCE' | 'ADD_TO_PROJECT'): Promise<void> {
    if (!selectedRoomId) return;
    try {
      setError(null);
      const file = await window.lyntar.rooms.uploadFile({ roomId: selectedRoomId, intent });
      if (file) setRoomFiles((current) => [file, ...current.filter((item) => item.id !== file.id)]);
    } catch (fileError) {
      setError(errorMessage(fileError));
    }
  }

  async function deleteRoomFile(fileId: string): Promise<void> {
    if (!selectedRoomId) return;
    try {
      setError(null);
      await window.lyntar.rooms.deleteFile(selectedRoomId, fileId);
      setRoomFiles((current) => current.filter((file) => file.id !== fileId));
    } catch (fileError) {
      setError(errorMessage(fileError));
    }
  }

  async function previewRoomImport(fileId: string, destinationRelative: string): Promise<void> {
    if (!selectedRoomId) return;
    try {
      setError(null);
      setRoomImport(
        await window.lyntar.rooms.previewImport({
          roomId: selectedRoomId,
          fileId,
          destinationRelative,
        }),
      );
    } catch (importError) {
      setError(errorMessage(importError));
    }
  }

  async function importRoomFile(): Promise<void> {
    if (!selectedRoomId || !roomImport) return;
    try {
      setError(null);
      await window.lyntar.rooms.importFile(selectedRoomId, roomImport.id);
      setRoomImport(null);
      setRoomFiles(await window.lyntar.rooms.listFiles(selectedRoomId));
    } catch (importError) {
      setError(errorMessage(importError));
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

  async function explainFile(): Promise<void> {
    if (!workspace || !learnPath.trim()) return;
    try {
      setError(null);
      setLearnResult(
        await window.lyntar.modes.learnFile({
          path: learnPath.trim(),
          depth: learnDepth,
          ...(learnQuestion.trim() ? { question: learnQuestion.trim() } : {}),
        }),
      );
    } catch (learnError) {
      setError(errorMessage(learnError));
    }
  }

  async function generateViva(): Promise<void> {
    if (!workspace) return;
    try {
      setError(null);
      const questions = await window.lyntar.modes.generateViva({
        categories: ['AUTHENTICATION', 'CODE_READING', 'TESTING'],
        difficulty: vivaDifficulty,
        count: 3,
      });
      setVivaQuestions(questions);
      setSelectedQuestionId(questions[0]?.id ?? '');
      setVivaAnswer('');
      setVivaEvaluation(null);
    } catch (vivaError) {
      setError(errorMessage(vivaError));
    }
  }

  async function evaluateViva(): Promise<void> {
    if (!selectedQuestion) return;
    try {
      setError(null);
      setVivaEvaluation(
        await window.lyntar.modes.evaluateViva({ question: selectedQuestion, answer: vivaAnswer }),
      );
    } catch (evaluationError) {
      setError(errorMessage(evaluationError));
    }
  }

  async function planHackathon(): Promise<void> {
    if (!hackathonProblem.trim()) return;
    try {
      setError(null);
      setHackathonPlan(
        await window.lyntar.modes.hackathonPlan({
          problem: hackathonProblem.trim(),
          criteria: hackathonCriteria
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      );
    } catch (planError) {
      setError(errorMessage(planError));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark">A</span>
          <div>
            <span className="brand">
              ASTRA <small>CODE</small>
            </span>
            <span className="brand-subtitle">Build it. Understand it. Ship it.</span>
          </div>
        </div>
        <nav aria-label="Primary navigation" className="primary-nav">
          {navItems.map((item) => (
            <button
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => setView(item.id)}
              title={item.hint}
            >
              <span className="nav-glyph" aria-hidden="true">
                {item.id === 'build'
                  ? '⌁'
                  : item.id === 'learn'
                    ? '◌'
                    : item.id === 'viva'
                      ? '?'
                      : item.id === 'hackathon'
                        ? '↗'
                        : item.id === 'projects'
                          ? '□'
                          : item.id === 'extensions'
                            ? '✦'
                            : '⋯'}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="connection-dot" />
          <span>{models.length > 0 ? 'Model catalog connected' : 'Waiting for model catalog'}</span>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div>
            <p className="section-kicker">{navItems.find((item) => item.id === view)?.label}</p>
            <p className="view-hint">{navItems.find((item) => item.id === view)?.hint}</p>
          </div>
          <div className="topbar-actions">
            <span className="model-pill">
              {selectedModelId === 'AUTO'
                ? 'Auto · server-routed'
                : (selectedModel?.displayName ?? 'No server model configured')}
            </span>
            {authUser ? (
              <button
                className="account-chip"
                onClick={() => setView('settings')}
                title="Open account settings"
              >
                {authUser.email}
              </button>
            ) : (
              <button className="account-chip" onClick={() => setView('settings')}>
                Sign in
              </button>
            )}
            <button className="open-button" onClick={() => void openWorkspace()}>
              Open repository
            </button>
          </div>
        </header>
        {workspace && (
          <div className="workspace-strip">
            <span className="workspace-status" />
            <span className="workspace-name">{workspace.displayName}</span>
            <span className="workspace-path">{workspace.canonicalRoot}</span>
            <span className="workspace-local">Local only</span>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {view === 'build' && (
          <BuildView
            models={models}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            prompt={prompt}
            setPrompt={setPrompt}
            workspace={workspace}
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            setSelectedRoomId={setSelectedRoomId}
            taskId={taskId}
            startTask={() => void startTask()}
            stopTask={() => void stopTask()}
            progressRows={progressRows}
            pendingPermission={pendingPermission}
            resolvePermission={(approved) => void resolvePermission(approved)}
            result={result}
            observedCredits={observedCredits}
            roomFiles={roomFiles}
            uploadRoomFile={(intent) => void uploadRoomFile(intent)}
            deleteRoomFile={(fileId) => void deleteRoomFile(fileId)}
            importDestinations={importDestinations}
            setImportDestination={(fileId, destination) =>
              setImportDestinations((current) => ({ ...current, [fileId]: destination }))
            }
            roomImport={roomImport}
            previewRoomImport={(fileId, destination) => void previewRoomImport(fileId, destination)}
            importRoomFile={() => void importRoomFile()}
          />
        )}
        {view === 'learn' && (
          <LearnView
            workspace={workspace}
            path={learnPath}
            setPath={setLearnPath}
            depth={learnDepth}
            setDepth={setLearnDepth}
            question={learnQuestion}
            setQuestion={setLearnQuestion}
            result={learnResult}
            explain={() => void explainFile()}
          />
        )}
        {view === 'viva' && (
          <VivaView
            workspace={workspace}
            difficulty={vivaDifficulty}
            setDifficulty={setVivaDifficulty}
            questions={vivaQuestions}
            selectedQuestion={selectedQuestion}
            selectedQuestionId={selectedQuestionId}
            setSelectedQuestionId={setSelectedQuestionId}
            answer={vivaAnswer}
            setAnswer={setVivaAnswer}
            evaluation={vivaEvaluation}
            generate={() => void generateViva()}
            evaluate={() => void evaluateViva()}
          />
        )}
        {view === 'hackathon' && (
          <HackathonView
            problem={hackathonProblem}
            setProblem={setHackathonProblem}
            criteria={hackathonCriteria}
            setCriteria={setHackathonCriteria}
            plan={hackathonPlan}
            generate={() => void planHackathon()}
          />
        )}
        {view === 'projects' && (
          <ProjectsView workspace={workspace} open={() => void openWorkspace()} />
        )}
        {view === 'extensions' && <ExtensionsView />}
        {view === 'settings' && (
          <SettingsView
            models={models}
            user={authUser}
            wallet={wallet}
            devices={devices}
            email={authEmail}
            password={authPassword}
            setEmail={setAuthEmail}
            setPassword={setAuthPassword}
            signIn={() => void signIn()}
            signInGoogle={() => void signInGoogle()}
            signOut={() => void signOut()}
            refreshDevices={() =>
              void window.lyntar.devices
                .list()
                .then(setDevices)
                .catch(() => setDevices([]))
            }
            revokeDevice={(deviceId) =>
              void window.lyntar.devices.revoke(deviceId).then(async () => {
                setDevices(await window.lyntar.devices.list());
              })
            }
          />
        )}
      </section>
    </main>
  );
}

function BuildView(props: {
  models: ModelCatalogEntry[];
  selectedModelId: string;
  setSelectedModelId: (value: string) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  workspace: WorkspaceDescriptor | null;
  rooms: DesktopRoom[];
  selectedRoomId: string;
  setSelectedRoomId: (value: string) => void;
  taskId: string | null;
  startTask: () => void;
  stopTask: () => void;
  progressRows: Array<{ eventId: string; label: string; kind: AgentEvent['type'] }>;
  pendingPermission: PendingPermission | null;
  resolvePermission: (approved: boolean) => void;
  result: IpcTaskResult | null;
  observedCredits: string;
  roomFiles: DesktopRoomFile[];
  uploadRoomFile: (intent: 'REFERENCE' | 'ADD_TO_PROJECT') => void;
  deleteRoomFile: (fileId: string) => void;
  importDestinations: Record<string, string>;
  setImportDestination: (fileId: string, destination: string) => void;
  roomImport: DesktopRoomFileImport | null;
  previewRoomImport: (fileId: string, destination: string) => void;
  importRoomFile: () => void;
}): ReactElement {
  return (
    <>
      <section className="welcome-block">
        <p className="section-kicker">A local development partner</p>
        <h1>What do you want to build?</h1>
        <p>
          Give Astra Code a focused task. It will inspect the repository, make bounded changes, run
          the right checks, and show exactly what changed.
        </p>
      </section>
      <section className="build-grid">
        <div className="panel task-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-index">01</span>
              <h2>Describe the work</h2>
            </div>
            <span className="budget">8 calls · 2 repairs</span>
          </div>
          <label className="field-label">
            Billing context
            <select
              value={props.selectedRoomId}
              onChange={(event) => props.setSelectedRoomId(event.target.value)}
            >
              <option value="">Personal project · personal credits</option>
              {props.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} · Room credits · {room.hostAvailability.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          {props.models.length > 0 && (
            <label className="field-label">
              Model
              <select
                value={props.selectedModelId}
                onChange={(event) => props.setSelectedModelId(event.target.value)}
              >
                <option value="AUTO">Auto · Astra chooses an eligible model</option>
                {props.models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <textarea
            value={props.prompt}
            onChange={(event) => props.setPrompt(event.target.value)}
            placeholder="Fix the failing validation test without changing the test."
          />
          <div className="actions">
            <button
              className="primary"
              disabled={
                !props.workspace ||
                !props.prompt.trim() ||
                !props.selectedModelId ||
                Boolean(props.taskId)
              }
              onClick={props.startTask}
            >
              Start task
            </button>
            <button className="secondary" disabled={!props.taskId} onClick={props.stopTask}>
              Stop
            </button>
          </div>
          {props.pendingPermission && (
            <AstraClineApprovalCard
              title={
                props.pendingPermission.action === 'budget.overrun'
                  ? 'Budget checkpoint'
                  : props.pendingPermission.risk === 'destructive'
                    ? 'High-risk approval needed'
                    : 'Approval needed'
              }
              description={props.pendingPermission.summary ?? props.pendingPermission.action}
              detail={props.pendingPermission.command}
              meta={props.pendingPermission.reason}
              onApprove={() => props.resolvePermission(true)}
              onReject={() => props.resolvePermission(false)}
            />
          )}
        </div>
        <div className="panel execution-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-index">02</span>
              <h2>Follow the work</h2>
            </div>
            <div className="execution-status">
              <AstraClineSessionStatus
                label={
                  props.taskId ? 'Astra agent running' : props.result ? 'Task completed' : 'Ready'
                }
                state={props.result ? 'idle' : props.taskId ? 'running' : 'idle'}
              />
              <span className="live-label">APPEND-ONLY EVENTS</span>
            </div>
          </div>
          <div className="progress-list">
            {props.progressRows.length === 0 ? (
              <p className="empty-state">
                Progress appears here once a task starts. No activity is simulated.
              </p>
            ) : (
              props.progressRows.map((row) => (
                <div className={`progress-row ${row.kind}`} key={row.eventId}>
                  <span className="event-symbol">
                    {row.kind.includes('failed')
                      ? '×'
                      : row.kind.includes('completed') || row.kind.includes('passed')
                        ? '✓'
                        : '·'}
                  </span>
                  <span>{row.label}</span>
                </div>
              ))
            )}
          </div>
          {(props.taskId || props.observedCredits !== '0') && (
            <p className="usage-line" aria-live="polite">
              Actual observed usage: {props.observedCredits} credits
              {props.taskId ? ' · still running' : ''}
            </p>
          )}
        </div>
      </section>
      {props.selectedRoomId && (
        <RoomFilesPanel
          files={props.roomFiles}
          upload={(intent) => props.uploadRoomFile(intent)}
          remove={(fileId) => props.deleteRoomFile(fileId)}
          importDestinations={props.importDestinations}
          setImportDestination={props.setImportDestination}
          importPreview={props.roomImport}
          previewImport={props.previewRoomImport}
          importFile={props.importRoomFile}
        />
      )}
      {props.result && <ResultPanel result={props.result} />}
    </>
  );
}

function RoomFilesPanel(props: {
  files: DesktopRoomFile[];
  upload: (intent: 'REFERENCE' | 'ADD_TO_PROJECT') => void;
  remove: (fileId: string) => void;
  importDestinations: Record<string, string>;
  setImportDestination: (fileId: string, destination: string) => void;
  importPreview: DesktopRoomFileImport | null;
  previewImport: (fileId: string, destination: string) => void;
  importFile: () => void;
}): ReactElement {
  return (
    <section className="panel room-files-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-index">03</span>
          <h2>Room files</h2>
        </div>
        <span className="live-label">CONTROLLED ROOM STORAGE</span>
      </div>
      <p className="muted">
        Uploads stay outside the host project. Reference files can inform a task; project imports
        require a validated preview and approval.
      </p>
      <div className="actions">
        <button className="secondary" onClick={() => props.upload('REFERENCE')}>
          Upload reference
        </button>
        <button className="secondary" onClick={() => props.upload('ADD_TO_PROJECT')}>
          Propose project import
        </button>
      </div>
      {props.files.length === 0 ? (
        <p className="empty-state">No Room files uploaded yet.</p>
      ) : (
        <div className="room-file-list">
          {props.files.map((file) => (
            <div className="room-file-row" key={file.id}>
              <div>
                <strong>{file.originalName}</strong>
                <span className="muted">
                  {file.intent === 'REFERENCE' ? 'Reference' : 'Import proposal'} ·{' '}
                  {file.contentType} · {file.sizeBytes.toLocaleString()} bytes ·{' '}
                  {file.securityState.toLowerCase()}
                </span>
                {file.intent === 'ADD_TO_PROJECT' && (
                  <div className="room-file-import-controls">
                    <input
                      aria-label={`Destination for ${file.originalName}`}
                      value={props.importDestinations[file.id] ?? ''}
                      onChange={(event) => props.setImportDestination(file.id, event.target.value)}
                      placeholder="Destination, e.g. public/assets"
                    />
                    <button
                      className="text-button"
                      disabled={!props.importDestinations[file.id]?.trim()}
                      onClick={() =>
                        props.previewImport(
                          file.id,
                          props.importDestinations[file.id]?.trim() ?? '',
                        )
                      }
                    >
                      Preview import
                    </button>
                  </div>
                )}
              </div>
              <button className="text-button" onClick={() => props.remove(file.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {props.importPreview && (
        <div className="room-import-preview">
          <strong>Import preview</strong>
          <span className="muted">
            Create {props.importPreview.manifest.createCount} · overwrite{' '}
            {props.importPreview.manifest.overwriteCount} · rejected{' '}
            {props.importPreview.manifest.rejectedCount}
          </span>
          <ul>
            {props.importPreview.manifest.entries.map((entry) => (
              <li key={entry.path}>
                {entry.action.toLowerCase()}: {entry.path}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={props.importPreview.manifest.rejectedCount > 0}
            onClick={props.importFile}
          >
            Approve and write on host
          </button>
        </div>
      )}
    </section>
  );
}

function ResultPanel({ result }: { result: IpcTaskResult }): ReactElement {
  return (
    <section className="panel result-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-index">03</span>
          <h2>{result.summary}</h2>
        </div>
        <span className={`status ${result.state.toLowerCase()}`}>{result.state}</span>
      </div>
      <p className="muted">{result.verification.summary}</p>
      <p className="usage-line">
        {result.usageSummary.requestCount} model request
        {result.usageSummary.requestCount === 1 ? '' : 's'}
        {result.usageSummary.actualCostUsd === null
          ? ' · provider cost unavailable'
          : ` · provider cost $${result.usageSummary.actualCostUsd.toFixed(6)}`}
      </p>
      <div className="diff-grid">
        <div>
          <h3>Astra changes</h3>
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
  );
}

function LearnView(props: {
  workspace: WorkspaceDescriptor | null;
  path: string;
  setPath: (value: string) => void;
  depth: LearnDepth;
  setDepth: (value: LearnDepth) => void;
  question: string;
  setQuestion: (value: string) => void;
  result: LearnResult | null;
  explain: () => void;
}): ReactElement {
  return (
    <ModeFrame
      kicker="Learn Mode"
      title="Understand the code you have."
      description="Explanations are grounded in files from the open local repository, not a generic lesson."
      workspace={props.workspace}
    >
      <div className="mode-grid">
        <div className="panel mode-form">
          <label className="field-label">
            File path
            <input
              value={props.path}
              onChange={(event) => props.setPath(event.target.value)}
              placeholder="src/auth.ts"
            />
          </label>
          <label className="field-label">
            Explain for
            <select
              value={props.depth}
              onChange={(event) => props.setDepth(event.target.value as LearnDepth)}
            >
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </select>
          </label>
          <label className="field-label">
            Question (optional)
            <input
              value={props.question}
              onChange={(event) => props.setQuestion(event.target.value)}
              placeholder="Why does this validate the input?"
            />
          </label>
          <button
            className="primary"
            disabled={!props.workspace || !props.path.trim()}
            onClick={props.explain}
          >
            Explain this file
          </button>
        </div>
        <div className="panel insight-panel">
          {props.result ? (
            <>
              <span className="result-kicker">{props.result.depth.toLowerCase()} explanation</span>
              <h2>{props.result.title}</h2>
              <p>{props.result.explanation}</p>
              <h3>Grounded in</h3>
              <ul>
                {props.result.relevantPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyMode
              title="Choose a file"
              body="Open a repository, enter a relative path, and Astra will explain the actual source snapshot."
            />
          )}
        </div>
      </div>
    </ModeFrame>
  );
}

function VivaView(props: {
  workspace: WorkspaceDescriptor | null;
  difficulty: VivaDifficulty;
  setDifficulty: (value: VivaDifficulty) => void;
  questions: VivaQuestion[];
  selectedQuestion: VivaQuestion | undefined;
  selectedQuestionId: string;
  setSelectedQuestionId: (value: string) => void;
  answer: string;
  setAnswer: (value: string) => void;
  evaluation: VivaEvaluation | null;
  generate: () => void;
  evaluate: () => void;
}): ReactElement {
  return (
    <ModeFrame
      kicker="Viva Mode"
      title="Practice against the project itself."
      description="Questions reference real files, symbols, and workflows so your preparation stays concrete."
      workspace={props.workspace}
    >
      <div className="mode-toolbar">
        <label className="field-label inline">
          Difficulty
          <select
            value={props.difficulty}
            onChange={(event) => props.setDifficulty(event.target.value as VivaDifficulty)}
          >
            <option value="BEGINNER">Beginner</option>
            <option value="INTERMEDIATE">Intermediate</option>
            <option value="ADVANCED">Advanced</option>
          </select>
        </label>
        <button className="primary" disabled={!props.workspace} onClick={props.generate}>
          Generate questions
        </button>
      </div>
      {props.questions.length > 0 ? (
        <div className="viva-layout">
          <div className="panel question-list">
            <h3>Questions</h3>
            {props.questions.map((question) => (
              <button
                className={`question-item ${question.id === props.selectedQuestionId ? 'selected' : ''}`}
                key={question.id}
                onClick={() => props.setSelectedQuestionId(question.id)}
              >
                <span>{question.category.replaceAll('_', ' ')}</span>
                <strong>{question.referencePath}</strong>
              </button>
            ))}
          </div>
          <div className="panel insight-panel">
            {props.selectedQuestion && (
              <>
                <span className="result-kicker">
                  {props.selectedQuestion.category.replaceAll('_', ' ').toLowerCase()} ·{' '}
                  {props.selectedQuestion.referencePath}
                </span>
                <h2>{props.selectedQuestion.prompt}</h2>
                <textarea
                  className="answer-box"
                  value={props.answer}
                  onChange={(event) => props.setAnswer(event.target.value)}
                  placeholder="Explain your answer in your own words."
                />
                <button
                  className="primary"
                  disabled={!props.answer.trim()}
                  onClick={props.evaluate}
                >
                  Evaluate answer
                </button>
                {props.evaluation && (
                  <div className="evaluation">
                    <strong>{props.evaluation.score}/100</strong>
                    <p>{props.evaluation.feedback}</p>
                    {props.evaluation.missingConcepts.length > 0 && (
                      <span className="muted">
                        Review: {props.evaluation.missingConcepts.join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="panel empty-wide">
          <EmptyMode
            title="Start a project-specific round"
            body="Astra will scan the local project and create a small set of questions from its real structure."
          />
        </div>
      )}
    </ModeFrame>
  );
}

function HackathonView(props: {
  problem: string;
  setProblem: (value: string) => void;
  criteria: string;
  setCriteria: (value: string) => void;
  plan: HackathonPlan | null;
  generate: () => void;
}): ReactElement {
  return (
    <ModeFrame
      kicker="Hackathon Mode"
      title="Shape the smallest credible MVP."
      description="Turn a problem statement into a working demo plan, with explicit non-goals and verification."
      workspace={null}
    >
      <div className="mode-grid">
        <div className="panel mode-form">
          <label className="field-label">
            Problem statement
            <textarea
              value={props.problem}
              onChange={(event) => props.setProblem(event.target.value)}
              placeholder="Help students track project deadlines."
            />
          </label>
          <label className="field-label">
            Judging criteria
            <input
              value={props.criteria}
              onChange={(event) => props.setCriteria(event.target.value)}
              placeholder="working demo, clear user value"
            />
          </label>
          <button className="primary" disabled={!props.problem.trim()} onClick={props.generate}>
            Create MVP plan
          </button>
        </div>
        {props.plan ? (
          <div className="panel plan-panel">
            <h2>MVP scope</h2>
            <ul>
              {props.plan.mvpScope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="plan-columns">
              <div>
                <h3>Must have</h3>
                <ul>
                  {props.plan.mustHave.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Future</h3>
                <ul>
                  {props.plan.future.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <h3>Demo plan</h3>
            <p>{props.plan.demoPlan}</p>
            <h3>Judge questions</h3>
            <ul>
              {props.plan.judgeQuestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="panel insight-panel">
            <EmptyMode
              title="Keep the scope honest"
              body="Start with the problem and the criteria. Astra will separate must-have work from future ideas."
            />
          </div>
        )}
      </div>
    </ModeFrame>
  );
}

function ProjectsView({
  workspace,
  open,
}: {
  workspace: WorkspaceDescriptor | null;
  open: () => void;
}): ReactElement {
  return (
    <ModeFrame
      kicker="Projects"
      title="Your repositories stay on your computer."
      description="Astra works inside a selected local Git repository and preserves pre-existing changes."
      workspace={workspace}
    >
      <div className="panel project-card">
        {workspace ? (
          <>
            <span className="result-kicker">OPEN PROJECT</span>
            <h2>{workspace.displayName}</h2>
            <code>{workspace.canonicalRoot}</code>
            <p className="muted">
              Git baseline captured when this workspace opened. Agent changes are isolated from
              files you had already modified.
            </p>
            <button className="secondary" onClick={open}>
              Choose another repository
            </button>
          </>
        ) : (
          <EmptyMode
            title="Open a local repository"
            body="Select a Git repository to begin building, learning, or practicing."
            actionLabel="Open repository"
            action={open}
          />
        )}
      </div>
    </ModeFrame>
  );
}

function ExtensionsView(): ReactElement {
  return (
    <ModeFrame
      kicker="Extensions"
      title="Good defaults, quietly applied."
      description="Astra Essentials route only when a task is relevant. They do not bypass workspace or permission boundaries."
      workspace={null}
    >
      <div className="extension-list">
        {essentials.map(([name, mode, description]) => (
          <div className="extension-row" key={name}>
            <div>
              <h2>{name}</h2>
              <p>{description}</p>
            </div>
            <span className="mode-badge">{mode}</span>
          </div>
        ))}
      </div>
      <div className="panel extension-note">
        <h3>More tools</h3>
        <p>
          Skills, MCP servers, Plugins, and API integrations will appear here after they are
          installed and explicitly authorized.
        </p>
      </div>
    </ModeFrame>
  );
}

function SettingsView({
  models,
  user,
  wallet,
  devices,
  email,
  password,
  setEmail,
  setPassword,
  signIn,
  signInGoogle,
  signOut,
  refreshDevices,
  revokeDevice,
}: {
  models: ModelCatalogEntry[];
  user: PublicUser | null;
  wallet: Wallet | null;
  devices: DesktopDevice[];
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  signIn: () => void;
  signInGoogle: () => void;
  signOut: () => void;
  refreshDevices: () => void;
  revokeDevice: (deviceId: string) => void;
}): ReactElement {
  return (
    <ModeFrame
      kicker="Settings"
      title="Keep the important things clear."
      description="Provider routing and model availability are controlled by the Astra API."
      workspace={null}
    >
      <div className="settings-grid">
        <div className="panel setting-card">
          <span className="result-kicker">ACCOUNT</span>
          {user ? (
            <>
              <h2>{user.email}</h2>
              <p className="muted">
                Plan: {user.planId} ·{' '}
                {user.emailVerifiedAt ? 'Email verified' : 'Email verification required'}
              </p>
              <p className="wallet-balance">
                {wallet ? `${wallet.availableCredits} credits available` : 'Wallet unavailable'}
              </p>
              <button className="secondary" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <h2>Sign in to sync your account</h2>
              <p className="muted">
                Session material is kept in encrypted Windows credential storage by the main
                process.
              </p>
              <label className="field-label">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label className="field-label">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                />
              </label>
              <button className="primary" disabled={!email.trim() || !password} onClick={signIn}>
                Sign in
              </button>
              <button className="secondary" onClick={signInGoogle}>
                Continue with Google
              </button>
            </>
          )}
        </div>
        <div className="panel setting-card">
          <span className="result-kicker">MODEL CATALOG</span>
          <h2>
            {models.length > 0
              ? `${models.length} approved model${models.length === 1 ? '' : 's'}`
              : 'No models available'}
          </h2>
          <p className="muted">
            The desktop does not contain provider credentials or a permanent model list.
          </p>
          {models.map((model) => (
            <div className="model-row" key={model.modelId}>
              <span>{model.displayName}</span>
              <span className="muted">
                {model.capabilities.supportsStreaming ? 'Streaming' : 'Non-streaming'}
              </span>
            </div>
          ))}
        </div>
        <div className="panel setting-card">
          <span className="result-kicker">PRIVACY</span>
          <h2>Local workspace by default</h2>
          <p className="muted">
            Source files are read through capability APIs. The renderer never receives generic
            filesystem or shell access.
          </p>
          <span className="safe-chip">Workspace boundary active</span>
        </div>
        {user && (
          <div className="panel setting-card">
            <div className="setting-card-heading">
              <span className="result-kicker">MY DEVICES</span>
              <button className="text-button" onClick={refreshDevices}>
                Refresh
              </button>
            </div>
            <h2>
              {devices.length
                ? `${devices.length} authorized device${devices.length === 1 ? '' : 's'}`
                : 'No devices registered'}
            </h2>
            <p className="muted">
              Remote access is limited to devices registered to this account. Local files remain on
              each device.
            </p>
            {devices.map((device) => (
              <div className="model-row" key={device.id}>
                <span>
                  {device.label} · {device.platform}/{device.architecture}
                </span>
                <button className="text-button" onClick={() => revokeDevice(device.id)}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModeFrame>
  );
}

function ModeFrame({
  kicker,
  title,
  description,
  workspace,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  workspace: WorkspaceDescriptor | null;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <section className="welcome-block mode-header">
        <p className="section-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {!workspace && kicker !== 'Hackathon Mode' && (
          <span className="muted">Open a repository to use project-grounded tools.</span>
        )}
      </section>
      {children}
    </>
  );
}

function EmptyMode({
  title,
  body,
  actionLabel,
  action,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  action?: () => void;
}): ReactElement {
  return (
    <div className="empty-mode">
      <span className="empty-mark">·</span>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {actionLabel && action && (
        <button className="primary" onClick={action}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
