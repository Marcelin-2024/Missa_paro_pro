import fs from 'fs';
import path from 'path';
import { hashPassword } from '../auth/password.utils.js';
import type { PlatformState } from './platform.types.js';

const STATE_FILE = path.join(process.cwd(), 'src', 'data', 'platformState.json');

function createInitialSeedState(): PlatformState {
  const now = new Date().toISOString();
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'settaocram@gmail.com').trim().toLowerCase();
  const superAdminEnvPass = (process.env.SUPER_ADMIN_PASSWORD || '').trim();
  const demoSecret = process.env.DEMO_PARISH_PASSWORD || 'password123';

  return {
    version: 1,
    superAdminClaimed: Boolean(superAdminEnvPass),
    settings: {
      platformName: 'Missa Paro — Côte d’Ivoire',
      supportEmail: 'support@missaparo.ci',
      tempPasswordTtlHours: 48,
      activationLinkTtlHours: 48,
      allowPublicFideleSignup: true,
      requireCureAnnouncementApproval: false,
    },
    users: [
      {
        id: 'user-super-admin-1',
        email: superAdminEmail,
        displayName: 'Super Administrateur Missa Paro',
        phone: '+225 0100000000',
        passwordHash: superAdminEnvPass ? hashPassword(superAdminEnvPass) : null,
        accountType: 'SUPER_ADMIN',
        isSuperAdmin: true,
        status: 'ACTIVE',
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
        activationTokenHash: null,
        activationExpiresAt: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      },
      {
        id: 'uid-paroisse-demo-1',
        email: 'marcelin@missaparo.com',
        displayName: 'Père Marcelin Attes',
        phone: '+225 0700000000',
        passwordHash: hashPassword(demoSecret),
        accountType: 'PARISH_STAFF',
        isSuperAdmin: false,
        status: 'ACTIVE',
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
        activationTokenHash: null,
        activationExpiresAt: null,
        preferredProvinceId: 'province_abidjan',
        preferredDioceseId: 'diocese_abidjan',
        preferredParishId: 'parish_sainte_rita',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      },
      {
        id: 'user-secretaire-demo-1',
        email: 'secretaire.sainterita@missaparo.com',
        displayName: 'Marie-Claire Kouassi',
        phone: '+225 0500000001',
        passwordHash: hashPassword(demoSecret),
        accountType: 'PARISH_STAFF',
        isSuperAdmin: false,
        status: 'ACTIVE',
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
        activationTokenHash: null,
        activationExpiresAt: null,
        preferredProvinceId: 'province_abidjan',
        preferredDioceseId: 'diocese_abidjan',
        preferredParishId: 'parish_sainte_rita',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      },
    ],
    parishes: [
      {
        id: 'parish_sainte_rita',
        directoryParishId: null,
        provinceId: 'province_abidjan',
        provinceName: "Province ecclésiastique d'Abidjan",
        dioceseId: 'diocese_abidjan',
        dioceseName: "Archidiocèse d'Abidjan",
        name: 'Paroisse Sainte Rita',
        location: 'Cocody, Abidjan',
        status: 'ACTIVE',
        phone: '+225 27 22 00 00 01',
        email: 'secretariat@sainterita.ci',
        address: 'Boulevard de la Paix, Cocody, Abidjan',
        massScheduleSummary: 'Lun–Sam : 06h30 & 18h30 · Dimanche : 07h00, 09h30, 11h30 & 18h30',
        chapelsEnabled: true,
        chapels: ['Chapelle Saint-Joseph', 'Chapelle Notre-Dame de la Paix'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'parish_cathedrale_saint_paul_plateau',
        directoryParishId: 'paroisse_cathedrale_saint_paul_plateau',
        provinceId: 'province_abidjan',
        provinceName: "Province ecclésiastique d'Abidjan",
        dioceseId: 'diocese_abidjan',
        dioceseName: "Archidiocèse d'Abidjan",
        name: 'Cathédrale Saint-Paul du Plateau',
        location: 'Plateau, Abidjan',
        status: 'ACTIVE',
        phone: '+225 27 20 21 00 00',
        email: 'contact@cathedralesaintpaul.ci',
        address: 'Avenue Terrasson de Fougères, Plateau, Abidjan',
        massScheduleSummary: 'Lun–Ven : 07h00 & 12h15 · Dimanche : 08h30, 10h30 & 18h00',
        chapelsEnabled: false,
        chapels: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    memberships: [
      {
        id: 'mem-marcelin-sainte-rita',
        userId: 'uid-paroisse-demo-1',
        parishId: 'parish_sainte_rita',
        status: 'ACTIVE',
        titleLabel: 'Curé & Administrateur paroissial',
        createdAt: now,
        updatedAt: now,
        createdBy: 'user-super-admin-1',
      },
      {
        id: 'mem-marie-sainte-rita',
        userId: 'user-secretaire-demo-1',
        parishId: 'parish_sainte_rita',
        status: 'ACTIVE',
        titleLabel: 'Secrétaire paroissiale',
        createdAt: now,
        updatedAt: now,
        createdBy: 'uid-paroisse-demo-1',
      },
    ],
    membershipRoles: [
      {
        id: 'mrole-1',
        membershipId: 'mem-marcelin-sainte-rita',
        parishId: 'parish_sainte_rita',
        userId: 'uid-paroisse-demo-1',
        roleCode: 'CURE',
        status: 'ACTIVE',
        assignedBy: 'user-super-admin-1',
        assignedAt: now,
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
      },
      {
        id: 'mrole-2',
        membershipId: 'mem-marcelin-sainte-rita',
        parishId: 'parish_sainte_rita',
        userId: 'uid-paroisse-demo-1',
        roleCode: 'PARISH_ADMIN',
        status: 'ACTIVE',
        assignedBy: 'user-super-admin-1',
        assignedAt: now,
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
      },
      {
        id: 'mrole-3',
        membershipId: 'mem-marie-sainte-rita',
        parishId: 'parish_sainte_rita',
        userId: 'user-secretaire-demo-1',
        roleCode: 'SECRETAIRE',
        status: 'ACTIVE',
        assignedBy: 'uid-paroisse-demo-1',
        assignedAt: now,
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
      },
    ],
    messes: [
      {
        id: 'messe-sr-1',
        parishId: 'parish_sainte_rita',
        date: '2026-11-29',
        horaire: '08h00 - 10h00',
        celebrant: 'Père Marcelin Attes',
        type: 'Messe dominicale',
        statut: 'A venir',
        createdBy: 'uid-paroisse-demo-1',
        createdAt: now,
      },
      {
        id: 'messe-sr-2',
        parishId: 'parish_sainte_rita',
        date: '2026-12-06',
        horaire: '10h00 - 12h00',
        celebrant: 'Père François Kouadio',
        type: 'Messe d’action de grâce',
        statut: 'A venir',
        createdBy: 'user-secretaire-demo-1',
        createdAt: now,
      },
      {
        id: 'messe-sp-1',
        parishId: 'parish_cathedrale_saint_paul_plateau',
        date: '2026-11-29',
        horaire: '10h30 - 12h30',
        celebrant: 'Père Curé Cathédrale',
        type: 'Messe solennelle',
        statut: 'A venir',
        createdBy: 'user-super-admin-1',
        createdAt: now,
      },
    ],
    annonces: [
      {
        id: 'ann-sr-1',
        parishId: 'parish_sainte_rita',
        type: 'Solennite',
        titre: 'Veillée de prière paroissiale',
        dateAnnonce: '2026-12-04',
        contenu: 'Tous les fidèles sont conviés à la grande veillée de prière à 19h00.',
        statut: 'PUBLISHED',
        createdBy: 'uid-paroisse-demo-1',
        approvedBy: 'uid-paroisse-demo-1',
        createdAt: now,
      },
      {
        id: 'ann-sr-2',
        parishId: 'parish_sainte_rita',
        type: 'Communique',
        titre: 'Inscriptions à la catéchèse',
        dateAnnonce: '2026-12-07',
        contenu: 'Le secrétariat accueille les familles du mardi au samedi pour la catéchèse.',
        statut: 'PUBLISHED',
        createdBy: 'user-secretaire-demo-1',
        approvedBy: 'uid-paroisse-demo-1',
        createdAt: now,
      },
    ],
    intentions: [
      {
        id: 'int-sr-1',
        trackingRef: 'INT-2026-1001',
        parishId: 'parish_sainte_rita',
        parishName: 'Paroisse Sainte Rita',
        provinceId: 'province_abidjan',
        dioceseId: 'diocese_abidjan',
        requesterUserId: null,
        requesterName: 'Famille Yao',
        requesterPhone: '+225 0708091011',
        requesterEmail: 'famille.yao@exemple.ci',
        objet: 'Action de grâce',
        details: 'Pour les bienfaits reçus durant cette année et la réussite des examens.',
        requestedAt: now,
        desiredDate: '2026-11-29',
        messeId: 'messe-sr-1',
        status: 'SCHEDULED',
        internalComment: 'Assignée à la messe de 08h00.',
        processedAt: now,
        processedBy: 'user-secretaire-demo-1',
        celebratedAt: null,
        celebratedBy: null,
        updatedAt: now,
      },
      {
        id: 'int-sr-2',
        trackingRef: 'INT-2026-1002',
        parishId: 'parish_sainte_rita',
        parishName: 'Paroisse Sainte Rita',
        provinceId: 'province_abidjan',
        dioceseId: 'diocese_abidjan',
        requesterUserId: null,
        requesterName: 'Adeline Bamba',
        requesterPhone: '+225 0504030201',
        requesterEmail: '',
        objet: 'Repos de l’âme',
        details: 'Pour le repos de l’âme de feu Jean-Baptiste Bamba.',
        requestedAt: now,
        desiredDate: '2026-12-06',
        messeId: null,
        status: 'PENDING',
        internalComment: '',
        processedAt: null,
        processedBy: null,
        celebratedAt: null,
        celebratedBy: null,
        updatedAt: now,
      },
      {
        id: 'int-sp-1',
        trackingRef: 'INT-2026-2001',
        parishId: 'parish_cathedrale_saint_paul_plateau',
        parishName: 'Cathédrale Saint-Paul du Plateau',
        provinceId: 'province_abidjan',
        dioceseId: 'diocese_abidjan',
        requesterUserId: null,
        requesterName: 'Serge Kouamé',
        requesterPhone: '+225 0102030405',
        requesterEmail: '',
        objet: 'Guérison',
        details: 'Intention confiée à la Cathédrale Saint-Paul.',
        requestedAt: now,
        desiredDate: '2026-11-29',
        messeId: 'messe-sp-1',
        status: 'PENDING',
        internalComment: '',
        processedAt: null,
        processedBy: null,
        celebratedAt: null,
        celebratedBy: null,
        updatedAt: now,
      },
    ],
    auditLogs: [
      {
        id: 'audit-seed-1',
        actorUserId: 'user-super-admin-1',
        actorEmail: superAdminEmail,
        scope: 'GLOBAL',
        parishId: null,
        action: 'PLATFORM_INITIALIZED',
        targetType: 'PLATFORM',
        targetId: 'missa-paro',
        summary: 'Initialisation de la plateforme multi-paroisses Missa Paro.',
        createdAt: now,
      },
    ],
    notifications: [
      {
        id: 'notif-seed-1',
        userId: null,
        parishId: 'parish_sainte_rita',
        trackingRef: 'INT-2026-1002',
        audience: 'PARISH_STAFF',
        type: 'INTENTION_RECEIVED',
        title: 'Nouvelle intention reçue',
        message: 'Une intention (Repos de l’âme) est en attente de traitement.',
        read: false,
        createdAt: now,
      },
    ],
  };
}

let cachedState: PlatformState | null = null;

export function getPlatformState(): PlatformState {
  if (cachedState) return cachedState;

  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STATE_FILE)) {
    const seed = createInitialSeedState();
    savePlatformState(seed);
    cachedState = seed;
    return cachedState;
  }

  const raw = fs.readFileSync(STATE_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as PlatformState;
  const superAdminEnvPass = (process.env.SUPER_ADMIN_PASSWORD || '').trim();
  if (!parsed.superAdminClaimed && superAdminEnvPass) {
    const sa = parsed.users.find((u) => u.isSuperAdmin);
    if (sa) {
      sa.passwordHash = hashPassword(superAdminEnvPass);
      sa.status = 'ACTIVE';
      sa.mustChangePassword = false;
      parsed.superAdminClaimed = true;
      savePlatformState(parsed);
      return parsed;
    }
  }
  cachedState = parsed;
  return cachedState;
}

export function savePlatformState(state: PlatformState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpFile, STATE_FILE);
  cachedState = state;
}

export function resetPlatformStateCache(): void {
  cachedState = null;
}
