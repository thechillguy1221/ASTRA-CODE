import type { ReactElement, ReactNode } from 'react';
import { AgentApprovalCard, type AgentApprovalAction } from './cline/agent-approval-card.js';
import { SessionStatus, type SessionStatusTone } from './cline/session-status.js';
import './cline/agent-approval-card.css';
import './cline/session-status.css';

export type AstraWorkspaceStatus = 'idle' | 'running' | 'error';

export function AstraClineSessionStatus({
  label,
  state,
}: {
  label: string;
  state: AstraWorkspaceStatus;
}): ReactElement {
  const tone: SessionStatusTone =
    state === 'error' ? 'error' : state === 'running' ? 'running' : 'neutral';
  return (
    <span className="astra-cline-session-status" data-cline-source="session-status">
      <SessionStatus label={label} tone={tone} />
    </span>
  );
}

export function AstraClineApprovalCard({
  title,
  description,
  detail,
  meta,
  onApprove,
  onReject,
  responding,
}: {
  title: ReactNode;
  description?: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  responding?: AgentApprovalAction;
}): ReactElement {
  return (
    <div className="astra-cline-approval" data-cline-source="agent-approval-card">
      <AgentApprovalCard
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(detail === undefined ? {} : { detail })}
        {...(meta === undefined ? {} : { meta })}
        onApprove={onApprove}
        onReject={onReject}
        {...(responding === undefined ? {} : { responding })}
      />
    </div>
  );
}
