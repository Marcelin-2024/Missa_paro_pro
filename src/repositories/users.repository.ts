import { getAdminDb } from '../config/firebaseAdmin.js';
import type { UserEntity } from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

function col() {
  return getAdminDb().collection(COLLECTIONS.USERS);
}

export async function findUserById(userId: string): Promise<UserEntity | null> {
  if (!userId) return null;
  const snap = await col().doc(userId).get();
  return snap.exists ? (snap.data() as UserEntity) : null;
}

export async function findUserByEmail(email: string): Promise<UserEntity | null> {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  const snap = await col().where('email', '==', cleanEmail).limit(1).get();
  if (!snap.empty) {
    return snap.docs[0].data() as UserEntity;
  }
  return null;
}

export async function findUserByActivationTokenHash(tokenHash: string): Promise<UserEntity | null> {
  if (!tokenHash) return null;
  const snap = await col().where('activationTokenHash', '==', tokenHash).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as UserEntity);
}

export async function findSuperAdminUsers(): Promise<UserEntity[]> {
  const snap = await col().where('isSuperAdmin', '==', true).get();
  return snap.docs.map((d) => d.data() as UserEntity);
}

export async function listAllUsers(): Promise<UserEntity[]> {
  const snap = await col().get();
  return snap.docs
    .map((d) => d.data() as UserEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listParishStaffUsers(): Promise<UserEntity[]> {
  const snap = await col().where('accountType', '==', 'PARISH_STAFF').get();
  return snap.docs
    .map((d) => d.data() as UserEntity)
    .filter((u) => !u.isSuperAdmin)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveUser(user: UserEntity): Promise<void> {
  await col().doc(user.id).set(stripUndefined({ ...user }));
}
