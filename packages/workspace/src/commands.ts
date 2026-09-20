import { spawn } from 'node:child_process';
import { assertWorkspacePath, type CanonicalWorkspace } from './path-security.js';
import { classifyCommand, type CommandRequest, type CommandRisk } from './command-policy.js';

export interface CommandResult {
  executable: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  originalEstimatedSize: number;
}

export class PermissionRequiredError extends Error {
  constructor(
    public readonly risk: CommandRisk,
    public readonly request: CommandRequest,
  ) {
    super(`Command requires ${risk} permission`);
    this.name = 'PermissionRequiredError';
  }
}

function quoteWindowsCmdArgument(value: string): string {
  if (/[&|<>^()%!\r\n]/.test(value)) {
    throw new Error('Command argument contains a Windows shell metacharacter');
  }
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

export class LocalCommandRunner {
  constructor(private readonly workspace: CanonicalWorkspace) {}

  async run(
    request: CommandRequest,
    signal: AbortSignal,
    options: { timeoutMs?: number; maxOutputBytes?: number } = {},
  ): Promise<CommandResult> {
    const risk = classifyCommand(request);
    if (risk === 'prohibited') throw new PermissionRequiredError(risk, request);
    if (risk !== 'safe' && request.approved !== true)
      throw new PermissionRequiredError(risk, request);
    const cwd = await assertWorkspacePath(this.workspace, request.cwdRelative, 'read');
    const executable =
      process.platform === 'win32' &&
      ['npm', 'npx', 'pnpm', 'yarn'].includes(request.executable.toLowerCase())
        ? `${request.executable}.cmd`
        : request.executable;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const maxOutputBytes = options.maxOutputBytes ?? 200_000;

    return new Promise((resolve, reject) => {
      const requiresWindowsBatchShell =
        process.platform === 'win32' && executable.toLowerCase().endsWith('.cmd');
      const childExecutable = requiresWindowsBatchShell
        ? (process.env.ComSpec ?? 'cmd.exe')
        : executable;
      const childArgs = requiresWindowsBatchShell
        ? ['/d', '/s', '/c', [executable, ...request.args].map(quoteWindowsCmdArgument).join(' ')]
        : request.args;
      const child = spawn(childExecutable, childArgs, {
        cwd,
        shell: false,
        windowsHide: true,
        signal,
      });
      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let observedOutputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let termination: Promise<void> | undefined;
      let abortError: Error | undefined;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);

      const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        observedOutputBytes += chunk.byteLength;
        if (outputBytes >= maxOutputBytes) {
          truncated = true;
          return;
        }
        const remaining = maxOutputBytes - outputBytes;
        const text = chunk.toString('utf8').slice(0, remaining);
        outputBytes += Buffer.byteLength(text);
        if (target === 'stdout') stdout += text;
        else stderr += text;
        if (text.length < chunk.toString('utf8').length) truncated = true;
      };

      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
      const terminate = (): void => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (process.platform === 'win32' && child.pid !== undefined) {
          termination ??= new Promise<void>((resolveTermination) => {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
              shell: false,
              windowsHide: true,
            });
            let finished = false;
            const finish = (): void => {
              if (finished) return;
              finished = true;
              resolveTermination();
            };
            killer.once('error', () => {
              child.kill();
              finish();
            });
            killer.once('close', finish);
          });
          return;
        }
        termination ??= Promise.resolve();
        child.kill();
      };
      signal.addEventListener('abort', terminate, { once: true });
      child.once('error', (error) => {
        if (error.name === 'AbortError' || signal.aborted) {
          abortError = error;
          return;
        }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', terminate);
        reject(error);
      });
      child.once('close', (exitCode, signalName) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', terminate);
        void (async () => {
          await termination;
          if (settled) return;
          settled = true;
          if (abortError) {
            reject(abortError);
            return;
          }
          resolve({
            executable,
            args: request.args,
            exitCode,
            signal: signalName,
            stdout,
            stderr,
            timedOut,
            truncated,
            originalEstimatedSize: observedOutputBytes,
          });
        })();
      });
    });
  }
}
