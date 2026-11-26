import { getAdminDb } from '../config/firebaseAdmin.js';
import type { AnnonceEntity, MesseEntity } from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

function messesCol() {
  return getAdminDb().collection(COLLECTIONS.MESSES);
}
function annoncesCol() {
  return getAdminDb().collection(COLLECTIONS.ANNONCES);
}

export async function listMessesByParishRepo(parishId: string): Promise<MesseEntity[]> {
  const snap = await messesCol().where('parishId', '==', parishId).get();
  return snap.docs
    .map((d) => d.data() as MesseEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAllMessesRepo(): Promise<MesseEntity[]> {
  const snap = await messesCol().get();
  return snap.docs
    .map((d) => d.data() as MesseEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function countMessesByParishRepo(parishId: string): Promise<number> {
  const agg = await messesCol().where('parishId', '==', parishId).count().get();
  return agg.data().count;
}

export async function findMesseByIdRepo(messeId: string): Promise<MesseEntity | null> {
  if (!messeId) return null;
  const snap = await messesCol().doc(messeId).get();
  return snap.exists ? (snap.data() as MesseEntity) : null;
}

export async function saveMesseRepo(messe: MesseEntity): Promise<void> {
  await messesCol().doc(messe.id).set(stripUndefined({ ...messe }));
}

export async function deleteMesseRepo(messeId: string): Promise<void> {
  await messesCol().doc(messeId).delete();
}

export async function listAnnoncesByParishRepo(parishId: string): Promise<AnnonceEntity[]> {
  const snap = await annoncesCol().where('parishId', '==', parishId).get();
  return snap.docs
    .map((d) => d.data() as AnnonceEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPublishedAnnoncesRepo(parishId?: string): Promise<AnnonceEntity[]> {
  const snap = parishId
    ? await annoncesCol().where('parishId', '==', parishId).get()
    : await annoncesCol().where('statut', '==', 'PUBLISHED').get();
  return snap.docs
    .map((d) => d.data() as AnnonceEntity)
    .filter((a) => a.statut === 'PUBLISHED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findAnnonceByIdRepo(annonceId: string): Promise<AnnonceEntity | null> {
  if (!annonceId) return null;
  const snap = await annoncesCol().doc(annonceId).get();
  return snap.exists ? (snap.data() as AnnonceEntity) : null;
}

export async function saveAnnonceRepo(annonce: AnnonceEntity): Promise<void> {
  await annoncesCol().doc(annonce.id).set(stripUndefined({ ...annonce }));
}

export async function deleteAnnonceRepo(annonceId: string): Promise<void> {
  await annoncesCol().doc(annonceId).delete();
}
