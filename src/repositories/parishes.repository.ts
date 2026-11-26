import { getAdminDb } from '../config/firebaseAdmin.js';
import type {
  MembershipRoleEntity,
  ParishEntity,
  ParishMembershipEntity,
} from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

function parishesCol() {
  return getAdminDb().collection(COLLECTIONS.PARISHES);
}
function membershipsCol() {
  return getAdminDb().collection(COLLECTIONS.PARISH_MEMBERSHIPS);
}
function rolesCol() {
  return getAdminDb().collection(COLLECTIONS.MEMBERSHIP_ROLES);
}

export async function listAllParishesRepo(): Promise<ParishEntity[]> {
  const snap = await parishesCol().get();
  return snap.docs
    .map((d) => d.data() as ParishEntity)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function listActiveParishesRepo(): Promise<ParishEntity[]> {
  const snap = await parishesCol().where('status', '==', 'ACTIVE').get();
  return snap.docs
    .map((d) => d.data() as ParishEntity)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function findParishByIdRepo(parishId: string): Promise<ParishEntity | null> {
  if (!parishId) return null;
  const snap = await parishesCol().doc(parishId).get();
  return snap.exists ? (snap.data() as ParishEntity) : null;
}

export async function findParishByIdOrDirectoryRepo(idOrDir: string): Promise<ParishEntity | null> {
  const clean = String(idOrDir || '').trim();
  if (!clean) return null;
  const direct = await findParishByIdRepo(clean);
  if (direct) return direct;
  const byDir = await parishesCol().where('directoryParishId', '==', clean).limit(1).get();
  return byDir.empty ? null : (byDir.docs[0].data() as ParishEntity);
}

export async function saveParishRepo(parish: ParishEntity): Promise<void> {
  await parishesCol().doc(parish.id).set(stripUndefined({ ...parish }));
}

export async function listMembershipsByUserRepo(userId: string): Promise<ParishMembershipEntity[]> {
  const snap = await membershipsCol().where('userId', '==', userId).get();
  return snap.docs.map((d) => d.data() as ParishMembershipEntity);
}

export async function listMembershipsByParishRepo(parishId: string): Promise<ParishMembershipEntity[]> {
  const snap = await membershipsCol().where('parishId', '==', parishId).get();
  return snap.docs.map((d) => d.data() as ParishMembershipEntity);
}

export async function listAllMembershipsRepo(): Promise<ParishMembershipEntity[]> {
  const snap = await membershipsCol().get();
  return snap.docs.map((d) => d.data() as ParishMembershipEntity);
}

export async function findMembershipByIdRepo(membershipId: string): Promise<ParishMembershipEntity | null> {
  if (!membershipId) return null;
  const snap = await membershipsCol().doc(membershipId).get();
  return snap.exists ? (snap.data() as ParishMembershipEntity) : null;
}

export async function findActiveMembershipRepo(
  userId: string,
  parishId: string
): Promise<ParishMembershipEntity | null> {
  const rows = await listMembershipsByUserRepo(userId);
  return rows.find((m) => m.parishId === parishId && m.status !== 'REMOVED') ?? null;
}

export async function saveMembershipRepo(membership: ParishMembershipEntity): Promise<void> {
  await membershipsCol().doc(membership.id).set(stripUndefined({ ...membership }));
}

export async function listMembershipRolesByParishRepo(parishId: string): Promise<MembershipRoleEntity[]> {
  const snap = await rolesCol().where('parishId', '==', parishId).get();
  return snap.docs.map((d) => d.data() as MembershipRoleEntity);
}

export async function listMembershipRolesByMembershipRepo(
  membershipId: string
): Promise<MembershipRoleEntity[]> {
  const snap = await rolesCol().where('membershipId', '==', membershipId).get();
  return snap.docs.map((d) => d.data() as MembershipRoleEntity);
}

export async function listAllActiveRolesRepo(): Promise<MembershipRoleEntity[]> {
  const snap = await rolesCol().where('status', '==', 'ACTIVE').get();
  return snap.docs.map((d) => d.data() as MembershipRoleEntity);
}

export async function saveMembershipRoleRepo(role: MembershipRoleEntity): Promise<void> {
  await rolesCol().doc(role.id).set(stripUndefined({ ...role }));
}

export async function expireOutdatedRolesRepo(scope?: {
  parishId?: string;
  userId?: string;
}): Promise<boolean> {
  const db = getAdminDb();
  let query = rolesCol().where('status', '==', 'ACTIVE');
  if (scope?.parishId) {
    query = query.where('parishId', '==', scope.parishId);
  } else if (scope?.userId) {
    query = query.where('userId', '==', scope.userId);
  }

  const snap = await query.get();
  const nowMs = Date.now();
  const expiredDocs = snap.docs.filter((doc) => {
    const data = doc.data() as MembershipRoleEntity;
    return Boolean(data.expiresAt && new Date(data.expiresAt).getTime() <= nowMs);
  });

  if (expiredDocs.length === 0) return false;

  const batch = db.batch();
  for (const doc of expiredDocs) {
    batch.update(doc.ref, { status: 'EXPIRED' });
  }
  await batch.commit();
  return true;
}
