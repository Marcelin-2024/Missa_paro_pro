import fs from 'fs';
import path from 'path';
import type {
  CatholicDirectoryDataset,
  DioceseEntry,
  ParishEntry,
  ParishRequestRecord,
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
const REQUESTS_PATH = path.join(process.cwd(), 'src', 'data', 'parishRequests.json');

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

export function readParishRequests(): ParishRequestRecord[] {
  try {
    if (!fs.existsSync(REQUESTS_PATH)) {
      fs.writeFileSync(REQUESTS_PATH, '[]\n', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(REQUESTS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ParishRequestRecord[]) : [];
  } catch {
    return [];
  }
}

export function writeParishRequests(requests: ParishRequestRecord[]): void {
  fs.mkdirSync(path.dirname(REQUESTS_PATH), { recursive: true });
  fs.writeFileSync(REQUESTS_PATH, JSON.stringify(requests, null, 2) + '\n', 'utf-8');
}
