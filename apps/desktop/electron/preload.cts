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
  events: {
    subscribe(listener: (event: AgentEvent) => void) {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
      ipcRenderer.on('agent.event', handler);
      return () => ipcRenderer.removeListener('agent.event', handler);
    },
  },
};

contextBridge.exposeInMainWorld('lyntar', api);
