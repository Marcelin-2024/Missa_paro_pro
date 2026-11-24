/**
 * Security Rules Verification Suite (Phase 0 — Dirty Dozen Payloads)
 * Covers all 12 adversarial test cases documented in security_spec.md.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const dirtyDozenCases: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Intention Create',
    collection: '/intentions/int-1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      fideleId: 'victim-uid',
      fideleNom: 'Attacker',
      messeId: 'messe-1',
      messeDate: '2026-12-01',
      messeHoraire: '08:00',
      celebrant: 'Père Francois',
      objetIntention: 'Action de grâce',
      detailIntention: 'Spoofed request',
      statut: 'en attente',
    },
  },
  {
    id: 2,
    name: 'Pre-Validated Intention Create',
    collection: '/intentions/int-2',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      fideleId: 'caller-uid',
      statut: 'validé',
    },
  },
  {
    id: 3,
    name: 'Orphaned Intention Create (non-existent messeId)',
    collection: '/intentions/int-3',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      fideleId: 'caller-uid',
      messeId: 'non-existent-mass',
      statut: 'en attente',
    },
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Create',
    collection: '/intentions/int-4',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      fideleId: 'caller-uid',
      messeId: 'messe-1',
      statut: 'en attente',
      isAdmin: true,
    },
  },
  {
    id: 5,
    name: 'Client Timestamp Forgery',
    collection: '/intentions/int-5',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      fideleId: 'caller-uid',
      createdAt: '2020-01-01T00:00:00Z',
    },
  },
  {
    id: 6,
    name: 'Privilege Escalation on User Update',
    collection: '/users/caller-uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      role: 'admin',
    },
  },
  {
    id: 7,
    name: 'PII Leak (Cross-User Read)',
    collection: '/users/other-uid/private/info',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    payload: {},
  },
  {
    id: 8,
    name: 'Unauthorized List Scraping',
    collection: '/intentions',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    payload: { queryFilter: 'none' },
  },
  {
    id: 9,
    name: 'Terminal State Bypass by Owner',
    collection: '/intentions/validated-int',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      detailIntention: 'Modified after validation',
    },
  },
  {
    id: 10,
    name: 'Role-Jumping Update by Owner',
    collection: '/intentions/pending-int',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      statut: 'validé',
    },
  },
  {
    id: 11,
    name: 'Resource Poisoning (Oversized Payload)',
    collection: '/intentions/int-11',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      detailIntention: 'x'.repeat(5000),
    },
  },
  {
    id: 12,
    name: 'Unverified Email Write',
    collection: '/users/unverified-uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      email_verified: false,
    },
  },
];
