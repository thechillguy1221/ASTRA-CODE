import {
  IpcCommandSchema,
  type AgentEvent,
  type IpcCommand,
  type AstraIpcApi,
  type WorkspaceDescriptor,
} from '@astra/contracts';
import { DesktopRuntime } from './desktop-runtime.js';

function parseCommand<T extends IpcCommand['type']>(
  type: T,
  payload: Record<string, unknown> = {},
): Extract<IpcCommand, { type: T }> {
  return IpcCommandSchema.parse({ type, ...payload }) as Extract<IpcCommand, { type: T }>;
}

export function buildCapabilityApiForTest(): AstraIpcApi {
  const listeners = new Set<(event: AgentEvent) => void>();
  return {
    workspace: {
      async open(): Promise<WorkspaceDescriptor | null> {
        return null;
      },
      async readFile(): Promise<string> {
        throw new Error('No test workspace configured');
      },
      async search(): Promise<Array<{ path: string; line: number; text: string }>> {
        return [];
      },
    },
    agent: {
      async startTask() {
        throw new Error('No test agent configured');
      },
      async cancelTask() {},
      async approveAction() {},
      async rejectAction() {},
    },
    models: {
      async list() {
        return [];
      },
    },
    auth: {
      async login() {
        throw new Error('No test API configured');
      },
      async status() {
        return null;
      },
      async logout() {},
      async googleStart() {
        throw new Error('No test API configured');
      },
      async googleComplete() {
        throw new Error('No test API configured');
      },
      onGoogleCallback() {
        return () => undefined;
      },
    },
    billing: {
      async wallet() {
        return null;
      },
    },
    devices: {
      async list() {
        return [];
      },
      async register() {
        throw new Error('No test API configured');
      },
      async revoke() {},
    },
    rooms: {
      async list() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async uploadFile() {
        throw new Error('No test API configured');
      },
      async deleteFile() {},
      async previewImport() {
        throw new Error('No test API configured');
      },
      async importFile() {
        throw new Error('No test API configured');
      },
    },
    modes: {
      async learnFile() {
        throw new Error('No test workspace configured');
      },
      async generateViva() {
        throw new Error('No test workspace configured');
      },
      async evaluateViva() {
        throw new Error('No test workspace configured');
      },
      async hackathonPlan() {
        throw new Error('No test workspace configured');
      },
    },
    events: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

export async function registerIpcHandlers(runtime: DesktopRuntime): Promise<void> {
  const { BrowserWindow, dialog, ipcMain } = await import('electron');
  ipcMain.handle('workspace.open', async () => {
    parseCommand('workspace.open');
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;
    return runtime.openWorkspace(selectedPath);
  });
  ipcMain.handle('workspace.readFile', (_event, relativePath: unknown) => {
    const command = parseCommand('workspace.readFile', { relativePath });
    return runtime.readFile(command.relativePath);
  });
  ipcMain.handle('workspace.search', (_event, query: unknown) => {
    const command = parseCommand('workspace.search', { query });
    return runtime.search(command.query);
  });
  ipcMain.handle('agent.startTask', (_event, input: unknown) => {
    const command = parseCommand(
      'agent.startTask',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.startTask(command);
  });
  ipcMain.handle('agent.cancelTask', (_event, taskId: unknown) => {
    const command = parseCommand('agent.cancelTask', { taskId });
    return runtime.cancelTask(command.taskId);
  });
  ipcMain.handle('agent.approveAction', (_event, taskId: unknown, requestId: unknown) => {
    const command = parseCommand('agent.approveAction', { taskId, requestId });
    return runtime.approveAction(command.taskId, command.requestId);
  });
  ipcMain.handle('agent.rejectAction', (_event, taskId: unknown, requestId: unknown) => {
    const command = parseCommand('agent.rejectAction', { taskId, requestId });
    return runtime.rejectAction(command.taskId, command.requestId);
  });
  ipcMain.handle('models.list', () => {
    parseCommand('models.list');
    return runtime.listModels();
  });
  ipcMain.handle('auth.login', (_event, input: unknown) => {
    const command = parseCommand(
      'auth.login',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.authLogin(command);
  });
  ipcMain.handle('auth.status', () => {
    parseCommand('auth.status');
    return runtime.authStatus();
  });
  ipcMain.handle('auth.logout', () => {
    parseCommand('auth.logout');
    return runtime.authLogout();
  });
  ipcMain.handle('auth.googleStart', async () => {
    const { shell } = await import('electron');
    const result = await runtime.authGoogleStart();
    await shell.openExternal(result.authorizationUrl);
    return result;
  });
  ipcMain.handle('auth.googleComplete', (_event, code: unknown) => {
    if (typeof code !== 'string') throw new Error('Google authorization code is invalid');
    return runtime.authGoogleComplete(code);
  });
  ipcMain.handle('billing.wallet', () => {
    parseCommand('billing.wallet');
    return runtime.billingWallet();
  });
  ipcMain.handle('devices.list', () => runtime.listDevices());
  ipcMain.handle('devices.register', () => runtime.registerDevice());
  ipcMain.handle('devices.revoke', (_event, deviceId: unknown) => {
    if (typeof deviceId !== 'string' || !deviceId) throw new Error('Device ID is invalid');
    return runtime.revokeDevice(deviceId);
  });
  ipcMain.handle('rooms.list', () => {
    parseCommand('rooms.list');
    return runtime.listRooms();
  });
  ipcMain.handle('rooms.files.list', (_event, roomId: unknown) => {
    const command = parseCommand('rooms.files.list', { roomId });
    return runtime.listRoomFiles(command.roomId);
  });
  ipcMain.handle('rooms.files.upload', async (_event, input: unknown) => {
    const command = parseCommand(
      'rooms.files.upload',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;
    return runtime.uploadRoomFile(command.roomId, command.intent, selectedPath);
  });
  ipcMain.handle('rooms.files.delete', (_event, roomId: unknown, fileId: unknown) => {
    const command = parseCommand('rooms.files.delete', { roomId, fileId });
    return runtime.deleteRoomFile(command.roomId, command.fileId);
  });
  ipcMain.handle('rooms.files.preview', (_event, input: unknown) => {
    const command = parseCommand(
      'rooms.files.preview',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.previewRoomFileImport(
      command.roomId,
      command.fileId,
      command.destinationRelative,
    );
  });
  ipcMain.handle('rooms.files.import', (_event, roomId: unknown, importId: unknown) => {
    const command = parseCommand('rooms.files.import', { roomId, importId });
    return runtime.importRoomFile(command.roomId, command.importId);
  });
  ipcMain.handle('modes.learnFile', (_event, input: unknown) => {
    const command = parseCommand(
      'modes.learnFile',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.learnFile(command);
  });
  ipcMain.handle('modes.generateViva', (_event, input: unknown) => {
    const command = parseCommand(
      'modes.generateViva',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.generateViva(command);
  });
  ipcMain.handle('modes.hackathonPlan', (_event, input: unknown) => {
    const command = parseCommand(
      'modes.hackathonPlan',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.hackathonPlan(command);
  });
  ipcMain.handle('modes.evaluateViva', (_event, input: unknown) => {
    const command = parseCommand(
      'modes.evaluateViva',
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    return runtime.evaluateViva(command);
  });
  runtime.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('agent.event', event);
  });
}
