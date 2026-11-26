import crypto from 'crypto';
import {
  findDioceseById,
  findParishById,
  findParishRequestByIdRepo,
  findProvinceById,
  getAllProvinces,
  listParishRequestsRepo,
  listPendingRequestsByDioceseRepo,
  saveParishRequestRepo,
} from './ecclesiastical.repository.js';
import type {
  DioceseEntry,
  EcclesiasticalRegistration,
  ParishEntry,
  ParishRequestRecord,
  ParishRequestStatus,
  ProvinceEntry,
} from './ecclesiastical.types.js';

export function normalizeSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function listProvincesSummary() {
  return getAllProvinces().map((province) => ({
    id: province.id,
    name: province.name,
    dioceseCount: province.dioceses.length,
  }));
}

export function listDiocesesForProvince(provinceId: string): {
  province: { id: string; name: string };
  dioceses: Array<Omit<DioceseEntry, 'parishes'> & { parishCount: number }>;
} | null {
  const province = findProvinceById(provinceId);
  if (!province) return null;

  return {
    province: {
      id: province.id,
      name: province.name,
    },
    dioceses: province.dioceses.map(({ parishes, ...rest }) => ({
      ...rest,
      parishCount: parishes.length,
    })),
  };
}

export function listParishesForDiocese(
  dioceseId: string,
  searchQuery = ''
): {
  province: { id: string; name: string };
  diocese: Omit<DioceseEntry, 'parishes'> & { parishCount: number };
  parishes: ParishEntry[];
} | null {
  const match = findDioceseById(dioceseId);
  if (!match) return null;

  const { province, diocese } = match;
  const term = normalizeSearchText(searchQuery);

  const filteredParishes = term
    ? diocese.parishes.filter((parish) => {
        const haystack = [
          parish.name,
          parish.location,
          parish.pastoralSectorOrDeanery ?? '',
          ...(parish.aliases ?? []),
        ]
          .map(normalizeSearchText)
          .join(' ');
        return haystack.includes(term);
      })
    : diocese.parishes;

  const { parishes: allParishes, ...dioceseMeta } = diocese;

  return {
    province: {
      id: province.id,
      name: province.name,
    },
    diocese: {
      ...dioceseMeta,
      parishCount: allParishes.length,
    },
    parishes: filteredParishes,
  };
}

export async function submitMissingParishRequest(input: {
  provinceId?: string;
  dioceseId: string;
  parishName: string;
  userId?: string | null;
}): Promise<
  | { ok: true; request: ParishRequestRecord }
  | { ok: false; statusCode: number; error: string }
> {
  const dioceseMatch = findDioceseById(String(input.dioceseId || '').trim());
  if (!dioceseMatch) {
    return {
      ok: false,
      statusCode: 404,
      error: 'Le diocèse sélectionné est introuvable.',
    };
  }

  const trimmedProvinceId = String(input.provinceId || '').trim();
  if (trimmedProvinceId && dioceseMatch.province.id !== trimmedProvinceId) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Le diocèse sélectionné ne correspond pas à la province ecclésiastique choisie.',
    };
  }

  const cleanName = String(input.parishName || '').trim().slice(0, 120);
  if (cleanName.length < 2) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Veuillez saisir un nom de paroisse valide (au moins 2 caractères).',
    };
  }

  const pendingInDiocese = await listPendingRequestsByDioceseRepo(dioceseMatch.diocese.id);
  const normalizedIncoming = normalizeSearchText(cleanName);
  const duplicatePending = pendingInDiocese.find(
    (req) => normalizeSearchText(req.parishName) === normalizedIncoming
  );

  if (duplicatePending) {
    return { ok: true, request: duplicatePending };
  }

  const record: ParishRequestRecord = {
    id: `preq-${crypto.randomUUID().slice(0, 12)}`,
    provinceId: dioceseMatch.province.id,
    dioceseId: dioceseMatch.diocese.id,
    parishName: cleanName,
    userId: input.userId ? String(input.userId).trim().slice(0, 128) : null,
    status: 'PENDING',
    submittedAt: new Date().toISOString(),
    adminDecisionNote: null,
    decidedAt: null,
  };

  await saveParishRequestRepo(record);
  return { ok: true, request: record };
}

export async function getParishRequests(
  status?: ParishRequestStatus
): Promise<ParishRequestRecord[]> {
  return listParishRequestsRepo(status);
}

export async function reviewParishRequest(input: {
  requestId: string;
  decision: 'APPROVED' | 'REJECTED';
  adminDecisionNote?: string;
}): Promise<
  | { ok: true; request: ParishRequestRecord }
  | { ok: false; statusCode: number; error: string }
> {
  const existing = await findParishRequestByIdRepo(input.requestId);
  if (!existing) {
    return { ok: false, statusCode: 404, error: 'Demande de paroisse introuvable.' };
  }

  const updated: ParishRequestRecord = {
    ...existing,
    status: input.decision,
    adminDecisionNote: input.adminDecisionNote
      ? String(input.adminDecisionNote).trim().slice(0, 300)
      : null,
    decidedAt: new Date().toISOString(),
  };

  await saveParishRequestRepo(updated);
  return { ok: true, request: updated };
}

export type EcclesiasticalValidationResult =
  | {
      valid: true;
      registration: EcclesiasticalRegistration;
      province: ProvinceEntry;
      diocese: DioceseEntry;
      parish?: ParishEntry;
    }
  | {
      valid: false;
      error: string;
    };

export const MISSING_PARISH_SENTINEL = '__missing__';

export async function validateEcclesiasticalRegistration(input: {
  provinceId?: string;
  dioceseId?: string;
  parishId?: string;
  missingParishName?: string;
  parishRequestId?: string;
  userId?: string | null;
}): Promise<EcclesiasticalValidationResult> {
  const provinceId = String(input.provinceId || '').trim();
  const dioceseId = String(input.dioceseId || '').trim();
  const parishId = String(input.parishId || '').trim();
  const missingParishName = String(input.missingParishName || '').trim();
  const providedRequestId = String(input.parishRequestId || '').trim();

  if (!provinceId) {
    return { valid: false, error: 'Veuillez sélectionner votre province ecclésiastique.' };
  }

  const province = findProvinceById(provinceId);
  if (!province) {
    return { valid: false, error: 'La province ecclésiastique sélectionnée est invalide.' };
  }

  if (!dioceseId) {
    return { valid: false, error: 'Veuillez sélectionner votre diocèse.' };
  }

  const dioceseMatch = findDioceseById(dioceseId);
  if (!dioceseMatch) {
    return { valid: false, error: 'Le diocèse sélectionné est invalide.' };
  }

  if (dioceseMatch.province.id !== province.id) {
    return {
      valid: false,
      error: 'Le diocèse sélectionné n’appartient pas à la province ecclésiastique choisie.',
    };
  }

  if (parishId === MISSING_PARISH_SENTINEL) {
    if (missingParishName.length < 2) {
      return {
        valid: false,
        error: 'Veuillez saisir le nom de votre paroisse (au moins 2 caractères).',
      };
    }

    let requestId = providedRequestId;
    if (requestId) {
      const existing = await findParishRequestByIdRepo(requestId);
      if (!existing || existing.dioceseId !== dioceseMatch.diocese.id) {
        requestId = '';
      }
    }

    if (!requestId) {
      const created = await submitMissingParishRequest({
        provinceId: province.id,
        dioceseId: dioceseMatch.diocese.id,
        parishName: missingParishName,
        userId: input.userId ?? null,
      });
      if (!created.ok) {
        return { valid: false, error: created.error };
      }
      requestId = created.request.id;
    }

    return {
      valid: true,
      province,
      diocese: dioceseMatch.diocese,
      registration: {
        provinceId: province.id,
        dioceseId: dioceseMatch.diocese.id,
        parishId: null,
        parishNameSnapshot: missingParishName.slice(0, 120),
        parishRequestId: requestId,
      },
    };
  }

  if (!parishId) {
    return { valid: false, error: 'Veuillez sélectionner votre paroisse.' };
  }

  const parishMatch = findParishById(parishId);
  if (!parishMatch) {
    return { valid: false, error: 'La paroisse sélectionnée est introuvable.' };
  }

  if (parishMatch.diocese.id !== dioceseMatch.diocese.id) {
    return {
      valid: false,
      error: 'La paroisse sélectionnée n’appartient pas au diocèse choisi.',
    };
  }

  return {
    valid: true,
    province,
    diocese: dioceseMatch.diocese,
    parish: parishMatch.parish,
    registration: {
      provinceId: province.id,
      dioceseId: dioceseMatch.diocese.id,
      parishId: parishMatch.parish.id,
      parishNameSnapshot: parishMatch.parish.name,
    },
  };
}
