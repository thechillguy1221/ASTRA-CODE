export const NO_LIVE_DATA = 'NO_LIVE_DATA' as const;

export interface AdminOverview {
  dataStatus: 'LIVE' | typeof NO_LIVE_DATA;
  totalUsers: number | null;
  verifiedUsers: number | null;
  activeUsers: number | null;
  dailyActiveUsers: number | null;
  monthlyActiveUsers: number | null;
  paidUsers: number | null;
  freeUsers: number | null;
  creditsIssued: string | null;
  creditsConsumed: string | null;
  providerCostUsd: string | null;
  customerCostUsd: string | null;
  absorbedCostUsd: string | null;
  revenueUsd: string | null;
  grossMarginUsd: string | null;
  grossMarginPercent: number | null;
  paymentFailures: number | null;
  billingAnomalies: number | null;
}

export interface AdminUsageRow {
  modelId: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number | null;
  providerCostUsd: string | null;
  customerCostUsd: string | null;
  credits: string | null;
}

export interface AdminAnalyticsPort {
  overview(): Promise<AdminOverview>;
  usage(): Promise<{ dataStatus: 'LIVE' | typeof NO_LIVE_DATA; rows: AdminUsageRow[] }>;
}

export class InMemoryAdminAnalytics implements AdminAnalyticsPort {
  private snapshot: AdminOverview = {
    dataStatus: NO_LIVE_DATA,
    totalUsers: null,
    verifiedUsers: null,
    activeUsers: null,
    dailyActiveUsers: null,
    monthlyActiveUsers: null,
    paidUsers: null,
    freeUsers: null,
    creditsIssued: null,
    creditsConsumed: null,
    providerCostUsd: null,
    customerCostUsd: null,
    absorbedCostUsd: null,
    revenueUsd: null,
    grossMarginUsd: null,
    grossMarginPercent: null,
    paymentFailures: null,
    billingAnomalies: null,
  };
  private usageRows: AdminUsageRow[] = [];

  setLiveSnapshot(snapshot: Omit<AdminOverview, 'dataStatus'>): void {
    this.snapshot = { ...snapshot, dataStatus: 'LIVE' };
  }

  setUsage(rows: AdminUsageRow[]): void {
    this.usageRows = rows.map((row) => ({ ...row }));
  }

  async overview(): Promise<AdminOverview> {
    return { ...this.snapshot };
  }
  async usage(): Promise<{ dataStatus: 'LIVE' | typeof NO_LIVE_DATA; rows: AdminUsageRow[] }> {
    return {
      dataStatus: this.usageRows.length ? 'LIVE' : NO_LIVE_DATA,
      rows: this.usageRows.map((row) => ({ ...row })),
    };
  }
}
