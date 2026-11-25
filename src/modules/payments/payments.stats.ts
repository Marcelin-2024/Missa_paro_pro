import type {
  PaymentEntity,
  PaymentProviderCode,
  PaymentStatus,
} from '../platform/platform.types.js';
import { getPlatformState } from '../platform/platform.repository.js';
import { PAYMENT_PROVIDERS_META, PAYMENT_STATUS_LABELS } from './payment.config.js';

export interface ProviderBreakdownItem {
  provider: PaymentProviderCode;
  name: string;
  brandClass: string;
  count: number;
  successCount: number;
  collectedAmount: number;
  sharePct: number;
}

export interface TimelineBucket {
  period: string;
  label: string;
  count: number;
  successCount: number;
  collectedAmount: number;
  barHeightBucket: number;
}

export interface PaymentStatistics {
  simulationMode: true;
  currency: 'XOF';
  totalCount: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
  cancelledCount: number;
  expiredCount: number;
  collectedAmount: number;
  pendingAmount: number;
  failedAmount: number;
  byProvider: ProviderBreakdownItem[];
  byStatus: Array<{ status: PaymentStatus; label: string; count: number; amount: number }>;
  timelineDaily: TimelineBucket[];
  timelineMonthly: TimelineBucket[];
  latestTransactions: PaymentEntity[];
}

function toHeightBucket(value: number, maxVal: number): number {
  if (maxVal <= 0 || value <= 0) return 0;
  const pct = Math.round((value / maxVal) * 100);
  const clamped = Math.max(10, Math.min(100, Math.round(pct / 5) * 5));
  return clamped;
}

export function computePaymentStatistics(filters?: {
  parishId?: string;
  dateFrom?: string;
  dateTo?: string;
}): PaymentStatistics {
  const state = getPlatformState();
  let rows = [...(state.payments || [])];

  if (filters?.parishId) {
    rows = rows.filter((p) => p.parishId === filters.parishId);
  }
  if (filters?.dateFrom) {
    const fromIso = filters.dateFrom.trim();
    rows = rows.filter((p) => p.createdAt.slice(0, 10) >= fromIso);
  }
  if (filters?.dateTo) {
    const toIso = filters.dateTo.trim();
    rows = rows.filter((p) => p.createdAt.slice(0, 10) <= toIso);
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const successRows = rows.filter((p) => p.status === 'SUCCESS');
  const pendingRows = rows.filter((p) => p.status === 'PENDING');
  const failedRows = rows.filter((p) => p.status === 'FAILED');
  const cancelledRows = rows.filter((p) => p.status === 'CANCELLED');
  const expiredRows = rows.filter((p) => p.status === 'EXPIRED');

  const collectedAmount = successRows.reduce((sum, p) => sum + p.amount, 0);
  const pendingAmount = pendingRows.reduce((sum, p) => sum + p.amount, 0);
  const failedAmount = [...failedRows, ...cancelledRows, ...expiredRows].reduce(
    (sum, p) => sum + p.amount,
    0
  );

  const providerCodes: PaymentProviderCode[] = ['WAVE', 'ORANGE_MONEY', 'MTN_MONEY', 'MOOV_MONEY'];
  const totalCount = rows.length;

  const byProvider: ProviderBreakdownItem[] = providerCodes.map((code) => {
    const pRows = rows.filter((r) => r.provider === code);
    const pSuccess = pRows.filter((r) => r.status === 'SUCCESS');
    const meta = PAYMENT_PROVIDERS_META[code];
    return {
      provider: code,
      name: meta.name,
      brandClass: meta.brandClass,
      count: pRows.length,
      successCount: pSuccess.length,
      collectedAmount: pSuccess.reduce((sum, r) => sum + r.amount, 0),
      sharePct: totalCount > 0 ? Math.round((pRows.length / totalCount) * 100) : 0,
    };
  });

  const statuses: PaymentStatus[] = ['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED', 'EXPIRED'];
  const byStatus = statuses.map((st) => {
    const stRows = rows.filter((r) => r.status === st);
    return {
      status: st,
      label: PAYMENT_STATUS_LABELS[st],
      count: stRows.length,
      amount: stRows.reduce((sum, r) => sum + r.amount, 0),
    };
  });

  const dailyMap = new Map<string, { count: number; successCount: number; collectedAmount: number }>();
  const monthlyMap = new Map<string, { count: number; successCount: number; collectedAmount: number }>();

  for (const row of rows) {
    const dayKey = row.createdAt.slice(0, 10);
    const monthKey = row.createdAt.slice(0, 7);

    const dayAcc = dailyMap.get(dayKey) || { count: 0, successCount: 0, collectedAmount: 0 };
    dayAcc.count += 1;
    if (row.status === 'SUCCESS') {
      dayAcc.successCount += 1;
      dayAcc.collectedAmount += row.amount;
    }
    dailyMap.set(dayKey, dayAcc);

    const monthAcc = monthlyMap.get(monthKey) || { count: 0, successCount: 0, collectedAmount: 0 };
    monthAcc.count += 1;
    if (row.status === 'SUCCESS') {
      monthAcc.successCount += 1;
      monthAcc.collectedAmount += row.amount;
    }
    monthlyMap.set(monthKey, monthAcc);
  }

  const dailyEntries = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7);
  const maxDailyCount = dailyEntries.reduce((max, [, v]) => Math.max(max, v.count), 0);
  const timelineDaily: TimelineBucket[] = dailyEntries.map(([period, v]) => ({
    period,
    label: period.slice(5).split('-').reverse().join('/'),
    count: v.count,
    successCount: v.successCount,
    collectedAmount: v.collectedAmount,
    barHeightBucket: toHeightBucket(v.count, maxDailyCount),
  }));

  const monthlyEntries = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6);
  const maxMonthlyCount = monthlyEntries.reduce((max, [, v]) => Math.max(max, v.count), 0);
  const timelineMonthly: TimelineBucket[] = monthlyEntries.map(([period, v]) => ({
    period,
    label: period,
    count: v.count,
    successCount: v.successCount,
    collectedAmount: v.collectedAmount,
    barHeightBucket: toHeightBucket(v.count, maxMonthlyCount),
  }));

  return {
    simulationMode: true,
    currency: 'XOF',
    totalCount,
    successCount: successRows.length,
    pendingCount: pendingRows.length,
    failedCount: failedRows.length,
    cancelledCount: cancelledRows.length,
    expiredCount: expiredRows.length,
    collectedAmount,
    pendingAmount,
    failedAmount,
    byProvider,
    byStatus,
    timelineDaily,
    timelineMonthly,
    latestTransactions: rows.slice(0, 8),
  };
}
