# Missa Paro — Security Specification (Multi-Paroisses & RBAC)

## 1. Data Invariants
1. **Identity Integrity**: Every user profile (`/users/{userId}`), PII record (`/users/{userId}/private/info`), and mass intention (`/intentions/{intentionId}`) MUST belong to the authenticated, email-verified user (`request.auth.uid`) on creation.
2. **No Self-Assigned Admin or Roles**: Users cannot assign themselves admin privileges in `/users/{userId}` (`role` restricted to `'fidele'` or `'paroisse'`), cannot write to `/admins/{adminId}`, and cannot self-grant parish roles in `/parishMemberships/{membershipId}`.
3. **Multi-Tenant Parish Isolation**: `/parishes/{parishId}` provisioning is restricted strictly to the Super Administrator (`settaocram@gmail.com`). Parish intentions, masses, announcements, members, and audit logs are strictly scoped to `parishId` on the Express RBAC backend and isolated in Firestore rules.
4. **PII Isolation**: Emails and phone numbers are isolated in `/users/{userId}/private/info` and are only readable/writable by the document owner or a verified admin.
5. **Referential & State Machine Integrity**: Mass intentions start at `PENDING` (Express) / `'en attente'` (Firestore), follow strict allowed transitions (`PENDING -> PROCESSING -> ACCEPTED -> SCHEDULED -> CELEBRATED`), and never leak internal comments publicly.
6. **Temporal Integrity & Audit Trail**: Timestamps enforce `request.time` on creation/update in Firestore, and `/auditLogs/{logId}` is append-only (`update` / `delete` denied).

## 2. Adversarial Security Cases (Expected: PERMISSION_DENIED / HTTP 403)
1. **Identity Spoofing on Intention Create**
2. **Pre-Validated Intention Create**
3. **Orphaned Intention Create (non-existent `messeId`)**
4. **Shadow Field Injection on Create (`isAdmin`, `extraField`)**
5. **Client Timestamp Forgery**
6. **Privilege Escalation on User Update**
7. **PII Leak (Cross-User Read)**
8. **Unauthorized List Scraping**
9. **Terminal State Bypass by Owner**
10. **Role-Jumping Update by Owner**
11. **Resource Poisoning (Oversized Payload)**
12. **Unverified Email Write**
13. **Cross-Parish Tenant Mutation (Parish A admin mutating Parish B resource)**
14. **Parish Admin Attempting Super Admin Provisioning**
15. **Tampering with Append-Only Audit Logs**
