import type { OutputHTMLAttributes } from 'react';

export type SessionStatusTone = 'neutral' | 'running' | 'error';

export interface SessionStatusProps extends OutputHTMLAttributes<HTMLOutputElement> {
  label: string;
  showLabel?: boolean;
  tone?: SessionStatusTone;
}

/**
 * Vendored from Cline SDK UI at the pinned source revision recorded in
 * docs/source-provenance.md. Keep this component's structure aligned with the
 * upstream component; Astra owns the wrapper and event-to-label mapping.
 */
export function SessionStatus({
  className,
  label,
  showLabel = true,
  tone = 'neutral',
  ...props
}: SessionStatusProps) {
  return (
    <output
      className={[
        'cline-ui-session-status inline-flex items-center gap-1.5 text-cline-ui-xs leading-none text-cline-ui-muted-foreground',
        `cline-ui-session-status--${tone}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <span
        aria-hidden="true"
        className="cline-ui-session-status__dot size-1.5 shrink-0 rounded-full"
      />
      <span className={showLabel ? undefined : 'cline-ui-sr-only sr-only'}>{label}</span>
    </output>
  );
}
