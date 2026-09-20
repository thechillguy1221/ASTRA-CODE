export type EmailKind = 'transactional' | 'marketing';

export interface EmailRecipientState {
  verified: boolean;
  unsubscribed: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  fromAddress: string;
}

export class EmailPolicy {
  canSend(input: { kind: EmailKind } & EmailRecipientState): boolean {
    if (input.unsubscribed) return false;
    if (input.kind === 'transactional') return true;
    return input.verified;
  }
}

export class SuppressionList {
  private readonly addresses = new Set<string>();

  suppress(address: string): void {
    this.addresses.add(address.trim().toLowerCase());
  }

  isSuppressed(address: string): boolean {
    return this.addresses.has(address.trim().toLowerCase());
  }
}
