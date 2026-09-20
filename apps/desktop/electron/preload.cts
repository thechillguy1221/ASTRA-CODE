// The sandboxed preload must compile to CommonJS; Electron does not load an ESM preload in this mode.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');
import type { AgentEvent, LyntarIpcApi, TaskBudget } from '@lyntar/contracts';

const { contextBridge, ipcRenderer } = electron;

const api: LyntarIpcApi = {
  workspace: {
    open: () => ipcRenderer.invoke('workspace.open'),
    readFile: (relativePath: string) => ipcRenderer.invoke('workspace.readFile', relativePath),
    search: (query: string) => ipcRenderer.invoke('workspace.search', query),
  },
  agent: {
    startTask: (input: { taskId: string; prompt: string; modelId: string; budget: TaskBudget }) =>
      ipcRenderer.invoke('agent.startTask', input),
    cancelTask: (taskId: string) => ipcRenderer.invoke('agent.cancelTask', taskId),
    approveAction: (taskId: string, requestId: string) =>
      ipcRenderer.invoke('agent.approveAction', taskId, requestId),
    rejectAction: (taskId: string, requestId: string) =>
      ipcRenderer.invoke('agent.rejectAction', taskId, requestId),
  },
  models: { list: () => ipcRenderer.invoke('models.list') },
  auth: {
    login: (input: {
      email: string;
      password: string;
      device: { label: string; platform: string; architecture: string; appVersion: string };
    }) => ipcRenderer.invoke('auth.login', input),
    status: () => ipcRenderer.invoke('auth.status'),
    logout: () => ipcRenderer.invoke('auth.logout'),
  },
  billing: {
    wallet: () => ipcRenderer.invoke('billing.wallet'),
  },
  modes: {
    learnFile: (input: {
      path: string;
      depth: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
      question?: string;
    }) => ipcRenderer.invoke('modes.learnFile', input),
    generateViva: (input: {
      categories: Array<
        | 'ARCHITECTURE'
        | 'DATABASE'
        | 'API'
        | 'AUTHENTICATION'
        | 'SECURITY'
        | 'DEPENDENCIES'
        | 'CODE_READING'
        | 'IMPLEMENTATION'
        | 'FAILURE_SCENARIOS'
        | 'DEPLOYMENT'
        | 'TESTING'
      >;
      difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
      count: number;
    }) => ipcRenderer.invoke('modes.generateViva', input),
    evaluateViva: (input: { question: unknown; answer: string }) =>
      ipcRenderer.invoke('modes.evaluateViva', input),
    hackathonPlan: (input: { problem: string; criteria: string[] }) =>
      ipcRenderer.invoke('modes.hackathonPlan', input),
  },
  events: {
    subscribe(listener: (event: AgentEvent) => void) {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
      ipcRenderer.on('agent.event', handler);
      return () => ipcRenderer.removeListener('agent.event', handler);
    },
  },
};

contextBridge.exposeInMainWorld('lyntar', api);
