import fs from 'fs';
import path from 'path';
import { getAdminDb } from '../../config/firebaseAdmin.js';
import { COLLECTIONS, stripUndefined } from '../../repositories/collections.js';
import type {
  CatholicDirectoryDataset,
  DioceseEntry,
  ParishEntry,
  ParishRequestRecord,
  ParishRequestStatus,
  ProvinceEntry,
} from './ecclesiastical.types.js';

interface IndexedDiocese {
  province: ProvinceEntry;
  diocese: DioceseEntry;
}

interface IndexedParish {
  province: ProvinceEntry;
  diocese: DioceseEntry;
  parish: ParishEntry;
}

const DIRECTORY_PATH = path.join(process.cwd(), 'src', 'data', 'catholicDirectory.json');

let cachedDataset: CatholicDirectoryDataset | null = null;
const provinceIndex = new Map<string, ProvinceEntry>();
const dioceseIndex = new Map<string, IndexedDiocese>();
const parishIndex = new Map<string, IndexedParish>();

function ensureDirectoryLoaded(): CatholicDirectoryDataset {
  if (cachedDataset) return cachedDataset;

  const raw = fs.readFileSync(DIRECTORY_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as CatholicDirectoryDataset;

  provinceIndex.clear();
  dioceseIndex.clear();
  parishIndex.clear();

  for (const province of parsed.provinces) {
    provinceIndex.set(province.id, province);
    for (const diocese of province.dioceses) {
      dioceseIndex.set(diocese.id, { province, diocese });
      for (const parish of diocese.parishes) {
        parishIndex.set(parish.id, { province, diocese, parish });
      }
    }
  }

  cachedDataset = parsed;
  return parsed;
}

export function getAllProvinces(): ProvinceEntry[] {
  return ensureDirectoryLoaded().provinces;
}

export function findProvinceById(provinceId: string): ProvinceEntry | undefined {
  ensureDirectoryLoaded();
  return provinceIndex.get(provinceId);
}

export function findDioceseById(dioceseId: string): IndexedDiocese | undefined {
  ensureDirectoryLoaded();
  return dioceseIndex.get(dioceseId);
}

export function findParishById(parishId: string): IndexedParish | undefined {
  ensureDirectoryLoaded();
  return parishIndex.get(parishId);
}

export function getDirectoryMetadata() {
  return ensureDirectoryLoaded().metadata;
}

function requestsCol() {
  return getAdminDb().collection(COLLECTIONS.PARISH_REQUESTS);
}

export async function listParishRequestsRepo(
  status?: ParishRequestStatus
): Promise<ParishRequestRecord[]> {
  const snap = status
    ? await requestsCol().where('status', '==', status).get()
    : await requestsCol().get();

  return snap.docs
    .map((d) => d.data() as ParishRequestRecord)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export async function findParishRequestByIdRepo(
  requestId: string
): Promise<ParishRequestRecord | null> {
  if (!requestId) return null;
  const snap = await requestsCol().doc(requestId).get();
  return snap.exists ? (snap.data() as ParishRequestRecord) : null;
}

export async function listPendingRequestsByDioceseRepo(
  dioceseId: string
): Promise<ParishRequestRecord[]> {
  const snap = await requestsCol().where('dioceseId', '==', dioceseId).get();
  return snap.docs
    .map((d) => d.data() as ParishRequestRecord)
    .filter((r) => r.status === 'PENDING');
}

export async function saveParishRequestRepo(record: ParishRequestRecord): Promise<void> {
  await requestsCol().doc(record.id).set(stripUndefined({ ...record }));
}
