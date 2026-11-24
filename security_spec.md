# Missa Paro — Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity Integrity**: Every user profile (`/users/{userId}`), PII record (`/users/{userId}/private/info`), and mass intention (`/intentions/{intentionId}`) MUST belong to the authenticated, email-verified user (`request.auth.uid`) on creation.
2. **No Self-Assigned Admin**: Users cannot assign themselves admin privileges in `/users/{userId}` (`role` restricted to `'fidele'` or `'paroisse'`) and cannot write to `/admins/{adminId}`.
3. **PII Isolation**: Emails and phone numbers are isolated in `/users/{userId}/private/info` and are only readable/writable by the document owner or a verified admin.
4. **Referential Integrity**: An intention in `/intentions/{intentionId}` MUST reference an existing mass document in `/messes/{messeId}` on creation (`exists()`).
5. **State Machine Integrity**: New intentions MUST start with `statut == 'en attente'`. Once an intention reaches `'validé'` or `'annulée'` (terminal states), regular owners cannot modify it; only verified admins can transition or correct terminal states.
6. **Temporal Integrity**: `createdAt` and `updatedAt` MUST equal `request.time` on creation, `createdAt` is immutable, and `updatedAt` MUST equal `request.time` on update.
7. **Strict Schema & Bounds**: Every string field has explicit `.size()` bounds, document IDs match `^[a-zA-Z0-9_\-]+$` (max 128 chars), and `hasAll` / `hasOnly` / `affectedKeys().hasOnly()` block shadow fields.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Identity Spoofing on Intention Create**: Unauthenticated or wrong `fideleId` (`fideleId: "other-user-uid"`).
2. **Pre-Validated Intention Create**: Creating an intention with `statut: "validé"` instead of `"en attente"`.
3. **Orphaned Intention Create**: Creating an intention referencing a non-existent `messeId: "non-existent-mass"`.
4. **Shadow Field Injection on Create**: Adding `"isAdmin": true` or `"extraField": "junk"` to `/intentions/{id}` or `/users/{id}`.
5. **Client Timestamp Forgery**: Creating an intention with `createdAt: new Date("2020-01-01")` instead of `request.time`.
6. **Privilege Escalation on User Update**: Updating `/users/{uid}` to change `role` or `uid`.
7. **PII Leak (Cross-User Read)**: Reading `/users/{otherUid}/private/info` as a non-owner, non-admin user.
8. **Unauthorized List Scraping**: Listing `/intentions` without filtering by `fideleId == request.auth.uid` as a non-admin user.
9. **Terminal State Bypass**: A faithful user editing `detailIntention` on an intention whose `statut` is already `'validé'`.
10. **Role-Jumping Update by Owner**: A faithful user updating their own intention's `statut` from `'en attente'` to `'validé'`.
11. **Resource Poisoning (Oversized Payload)**: Submitting `detailIntention` with 5,000+ characters (> 1000 limit) or a >128-char document ID.
12. **Unverified Email Write**: Attempting a write when `request.auth.token.email_verified == false`.
