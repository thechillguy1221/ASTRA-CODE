import { randomUUID } from 'node:crypto';
import {
  type AgentEvent,
  type ModelDecision,
  type ModelMessage,
  type TaskState,
  type UsageReceipt,
  type UsageSummary,
} from '@lyntar/contracts';
import { BudgetExceededError, BudgetTracker } from './budget.js';
import { CancellationToken, waitForCancellation } from './cancellation.js';
import { createAgentEvent } from './events.js';
import {
  type AgentPorts,
  type PermissionAction,
  type StartTaskInput,
  type TaskResult,
  type VerificationResult,
} from './ports.js';
import { TaskStateController } from './state.js';

interface ActiveTask {
  token: CancellationToken;
  pendingPermissions: Map<string, (approved: boolean) => void>;
  deadlineExceeded: boolean;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function clip(value: string, max = 20_000): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`;
}

function commandLabel(request: { executable: string; args: string[] }): string {
  return `${request.executable} (${request.args.length} argument${request.args.length === 1 ? '' : 's'})`;
}

function sumReceiptField(
  receipts: UsageReceipt[],
  getValue: (receipt: UsageReceipt) => number | null | undefined,
): number | null {
  if (receipts.length === 0) return null;
  const values = receipts.map(getValue);
  if (values.some((value) => value === null || value === undefined)) return null;
  return values.map((value) => Number(value)).reduce((sum, value) => sum + value, 0);
}

function summarizeReceipts(receipts: UsageReceipt[]): UsageSummary {
  return {
    requestCount: receipts.length,
    inputTokens: sumReceiptField(receipts, (receipt) => receipt.inputTokens),
    outputTokens: sumReceiptField(receipts, (receipt) => receipt.outputTokens),
    cacheReadTokens: sumReceiptField(
      receipts,
      (receipt) => receipt.cacheReadTokens ?? receipt.cacheTokens,
    ),
    cacheWriteTokens: sumReceiptField(receipts, (receipt) => receipt.cacheWriteTokens),
    reasoningUnits: sumReceiptField(receipts, (receipt) => receipt.reasoningUnits),
    otherBillableUnits: sumReceiptField(receipts, (receipt) => receipt.otherBillableUnits),
    actualCostUsd: sumReceiptField(receipts, (receipt) => receipt.actualCostUsd),
  };
}

export class AgentTaskRunner {
  private readonly active = new Map<string, ActiveTask>();

  constructor(private readonly ports: AgentPorts) {}

  start(input: StartTaskInput): Promise<TaskResult> {
    if (this.active.has(input.taskId)) throw new Error(`Task is already running: ${input.taskId}`);
    const active: ActiveTask = {
      token: new CancellationToken(),
      pendingPermissions: new Map(),
      deadlineExceeded: false,
    };
    const deadlineTimer = setTimeout(() => {
      active.deadlineExceeded = true;
      active.token.cancel('Task wall-time budget exceeded');
    }, input.budget.maxWallTimeMs);
    this.active.set(input.taskId, active);
    if (input.signal?.aborted) active.token.cancel('caller cancelled task');
    else
      input.signal?.addEventListener('abort', () => active.token.cancel('caller cancelled task'), {
        once: true,
      });
    return this.run(input, active).finally(() => {
      clearTimeout(deadlineTimer);
      this.active.delete(input.taskId);
    });
  }

  cancel(taskId: string, reason = 'Task cancelled by user'): void {
    this.active.get(taskId)?.token.cancel(reason);
  }

  resolvePermission(taskId: string, requestId: string, approved: boolean): void {
    const resolver = this.active.get(taskId)?.pendingPermissions.get(requestId);
    if (!resolver) return;
    this.active.get(taskId)?.pendingPermissions.delete(requestId);
    resolver(approved);
  }

  private async run(input: StartTaskInput, active: ActiveTask): Promise<TaskResult> {
    const controller = new TaskStateController();
    const budget = new BudgetTracker(input.budget);
    const events: AgentEvent[] = [];
    const messages: ModelMessage[] = [
      {
        role: 'system',
        content:
          'You are Lyntar agent. Use bounded structured actions and never expose hidden reasoning.',
      },
      { role: 'user', content: input.prompt },
    ];
    const baseline = await this.ports.git.captureBaseline();
    let verification: VerificationResult = {
      status: 'unavailable',
      summary: 'Verification has not run',
      stdout: '',
      stderr: '',
    };
    let summary = 'Task did not complete';
    const unresolvedIssues: string[] = [];

    const emit = async (type: AgentEvent['type'], payload: unknown): Promise<void> => {
      const event = createAgentEvent(input.taskId, type, payload);
      events.push(event);
      await this.ports.event.append(event);
    };
    const transition = (next: TaskState): void => controller.transition(next);
    const currentDiff = async () => this.ports.git.diffFromBaseline(baseline);

    try {
      await emit('task.started', { summary: 'Task started' });
      await emit('analysis.started', { summary: 'Analyzing the requested change' });
      transition('ANALYZING');
      transition('PLANNING');

      while (true) {
        active.token.throwIfCancelled();
        budget.assertWallTime();
        budget.consume('model');
        const requestId = randomUUID();
        await emit('model.requested', { modelId: input.modelId, requestId });
        let decision: ModelDecision | undefined;
        for await (const event of this.ports.model.complete(
          {
            requestId,
            taskId: input.taskId,
            ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
            modelId: input.modelId,
            messages,
          },
          active.token.signal,
        )) {
          active.token.throwIfCancelled();
          if (event.type === 'provider')
            await emit('model.streaming', { summary: 'Receiving model output' });
          if (event.type === 'decision') {
            decision = event.decision;
            await emit('model.completed', { summary: event.decision.summary });
          } else if (event.type === 'usage') {
            this.ports.receipts.add(event.receipt);
            await emit('usage.received', {
              requestId: event.receipt.requestId,
              actualCostUsd: event.receipt.actualCostUsd,
            });
            if (event.receipt.actualCostUsd !== null)
              budget.recordCost(event.receipt.actualCostUsd);
          }
        }
        if (!decision) throw new Error('Model returned no decision');
        if (controller.current === 'PLANNING') transition('EXECUTING');
        if (decision.kind === 'finish') {
          transition('VERIFYING');
          await emit('verification.started', { summary: 'Running project verification' });
          await emit('command.started', { command: 'project verification' });
          verification = await this.ports.verification.verify(active.token.signal);
          await emit('command.completed', {
            command: verification.command ?? 'project verification',
            exitCode: verification.status === 'passed' ? 0 : null,
          });
          if (verification.status === 'passed') {
            summary = decision.summary;
            await emit('verification.completed', { summary: verification.summary });
            await emit('verification.passed', { summary: verification.summary });
            transition('COMPLETED');
            await emit('task.completed', { summary });
            break;
          }
          if (verification.status === 'cancelled')
            throw Object.assign(new Error('Verification cancelled'), { name: 'AbortError' });
          if (verification.status === 'unavailable') {
            unresolvedIssues.push(verification.summary);
            transition('BLOCKED');
            summary = verification.summary;
            await emit('task.blocked', { summary });
            break;
          }
          await emit('verification.failed', {
            command: verification.command ?? 'project verification',
            summary: clip(`${verification.summary}: ${verification.stderr || verification.stdout}`),
          });
          try {
            budget.consume('repair');
          } catch (error) {
            if (!(error instanceof BudgetExceededError)) throw error;
            unresolvedIssues.push(verification.summary);
            transition('BLOCKED');
            summary = `Repair budget exhausted: ${verification.summary}`;
            await emit('task.blocked', { summary });
            break;
          }
          transition('REPAIRING');
          await emit('repair.started', {
            attempt: budget.snapshot().repairs,
            summary: 'Repairing after failed verification',
          });
          messages.push({
            role: 'user',
            content: `Verification failed. Repair the implementation without changing tests. Output:\n${clip(verification.stderr || verification.stdout)}`,
          });
          transition('EXECUTING');
          continue;
        }

        const keepGoing = await this.executeDecision(
          active,
          controller,
          decision,
          messages,
          budget,
          emit,
        );
        if (!keepGoing) {
          unresolvedIssues.push('Task ended without a final verification decision');
          transition('BLOCKED');
          summary = 'Task ended without a final verification decision';
          await emit('task.blocked', { summary });
          break;
        }
      }
    } catch (error) {
      if (active.deadlineExceeded) {
        if (!['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(controller.current))
          controller.transition('BLOCKED');
        summary = 'Task budget exceeded: wallTime';
        unresolvedIssues.push(summary);
        await emit('task.blocked', { summary });
      } else if (active.token.signal.aborted || isAbortError(error)) {
        if (!['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(controller.current))
          controller.transition('CANCELLED');
        summary = active.token.reason ?? 'Task cancelled';
        await emit('task.cancelled', { summary });
      } else if (error instanceof BudgetExceededError) {
        if (!['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(controller.current))
          controller.transition('BLOCKED');
        summary = error.message;
        unresolvedIssues.push(error.message);
        await emit('task.blocked', { summary });
      } else {
        if (!['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(controller.current))
          controller.transition('FAILED');
        summary = error instanceof Error ? error.message : 'Agent task failed';
        unresolvedIssues.push(summary);
        await emit('task.failed', { summary });
      }
    }

    const usageReceipts = this.ports.receipts.list(input.taskId);
    return {
      taskId: input.taskId,
      state: controller.current,
      summary,
      events,
      gitDiff: await currentDiff(),
      verification,
      unresolvedIssues,
      usageReceipts,
      usageSummary: summarizeReceipts(usageReceipts),
    };
  }

  private async executeDecision(
    active: ActiveTask,
    controller: TaskStateController,
    decision: Exclude<ModelDecision, { kind: 'finish' }>,
    messages: ModelMessage[],
    budget: BudgetTracker,
    emit: (type: AgentEvent['type'], payload: unknown) => Promise<void>,
  ): Promise<boolean> {
    if (decision.kind === 'message') {
      messages.push({ role: 'assistant', content: decision.summary });
      return true;
    }
    if (decision.kind === 'readFile') {
      const action: PermissionAction = {
        kind: 'readFile',
        path: decision.path,
        summary: decision.summary,
      };
      if (!(await this.authorize(active, controller, action, emit))) return false;
      const content = await this.ports.workspace.readFile(decision.path);
      await emit('tool.requested', { tool: 'workspace.readFile', summary: decision.summary });
      await emit('file.read', { path: decision.path });
      messages.push({ role: 'tool', content: `File ${decision.path}:\n${clip(content)}` });
      return true;
    }
    if (decision.kind === 'search') {
      const action: PermissionAction = {
        kind: 'search',
        query: decision.query,
        summary: decision.summary,
      };
      if (!(await this.authorize(active, controller, action, emit))) return false;
      const results = await this.ports.workspace.search(decision.query);
      await emit('tool.requested', { tool: 'workspace.search', summary: decision.summary });
      messages.push({ role: 'tool', content: JSON.stringify(results.slice(0, 100)) });
      return true;
    }
    if (decision.kind === 'patch') {
      const action: PermissionAction = {
        kind: 'patch',
        paths: decision.files.map((file) => file.path),
        summary: decision.summary,
      };
      if (!(await this.authorize(active, controller, action, emit))) return false;
      await emit('tool.requested', { tool: 'workspace.writeBatch', summary: decision.summary });
      await emit('patch.started', {
        paths: decision.files.map((file) => file.path),
        fileCount: decision.files.length,
      });
      let result: Awaited<ReturnType<AgentPorts['patch']['apply']>>;
      try {
        result = await this.ports.patch.apply({ files: decision.files }, active.token.signal);
      } catch (error) {
        await emit('patch.rolled_back', {
          paths: decision.files.map((file) => file.path),
          fileCount: decision.files.length,
        });
        throw error;
      }
      await emit('patch.applied', { paths: result.paths, fileCount: result.paths.length });
      messages.push({ role: 'tool', content: `Applied patch to: ${result.paths.join(', ')}` });
      return true;
    }
    const request = {
      executable: decision.executable,
      args: decision.args,
      cwdRelative: decision.cwdRelative,
    };
    const action: PermissionAction = { kind: 'command', request, summary: decision.summary };
    if (!(await this.authorize(active, controller, action, emit))) return false;
    budget.consume('command');
    await emit('tool.requested', { tool: 'terminal.run', summary: decision.summary });
    await emit('command.started', { command: commandLabel(request) });
    const result = await this.ports.command.run(
      { ...request, approved: true },
      active.token.signal,
    );
    await emit('command.completed', {
      command: commandLabel(request),
      exitCode: result.exitCode,
    });
    messages.push({
      role: 'tool',
      content: `exitCode=${result.exitCode}\ntruncated=${result.truncated}\n${
        result.originalEstimatedSize === undefined
          ? ''
          : `originalEstimatedSize=${result.originalEstimatedSize}\n`
      }stdout:\n${clip(result.stdout)}\nstderr:\n${clip(result.stderr)}`,
    });
    return true;
  }

  private async authorize(
    active: ActiveTask,
    controller: TaskStateController,
    action: PermissionAction,
    emit: (type: AgentEvent['type'], payload: unknown) => Promise<void>,
  ): Promise<boolean> {
    const outcome = await this.ports.permission.evaluate(action);
    if (outcome.kind === 'allow') return true;
    const requestId = randomUUID();
    await emit('permission.requested', {
      requestId,
      action: action.kind,
      summary: action.summary,
      reason: outcome.reason,
      ...(action.kind === 'command' ? { command: commandLabel(action.request) } : {}),
      ...(outcome.kind === 'request' && outcome.risk ? { risk: outcome.risk } : {}),
    });
    if (outcome.kind === 'deny') {
      await emit('permission.denied', { requestId, action: action.kind });
      return false;
    }
    if (controller.current === 'EXECUTING') controller.transition('WAITING_FOR_PERMISSION');
    const approval = new Promise<boolean>((resolve) =>
      active.pendingPermissions.set(requestId, resolve),
    );
    try {
      const approved = await Promise.race([approval, waitForCancellation(active.token.signal)]);
      if (approved) {
        controller.transition('EXECUTING');
        await emit('permission.granted', { requestId, action: action.kind });
      } else {
        await emit('permission.denied', { requestId, action: action.kind });
      }
      return approved;
    } finally {
      active.pendingPermissions.delete(requestId);
    }
  }
}
