export const COLLECTIONS = {
  SYSTEM_METADATA: 'systemMetadata',
  PLATFORM_SETTINGS: 'platformSettings',
  USERS: 'users',
  PARISHES: 'parishes',
  PARISH_MEMBERSHIPS: 'parishMemberships',
  MEMBERSHIP_ROLES: 'membershipRoles',
  MESSES: 'messes',
  ANNONCES: 'annonces',
  INTENTIONS: 'intentions',
  PAYMENTS: 'payments',
  PAYMENT_EVENTS: 'paymentEvents',
  PARISH_REQUESTS: 'parishRequests',
  AUDIT_LOGS: 'auditLogs',
  NOTIFICATIONS: 'notifications',
  CONTACTS: 'contacts',
  REVIEWS: 'reviews',
  PUSH_TOKENS: 'pushTokens',
  SESSIONS: 'sessions',
  LOGIN_ATTEMPTS: 'loginAttempts',
} as const;

export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function sanitizeDocId(rawId: string): string {
  return String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
}
