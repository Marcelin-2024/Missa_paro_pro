import type { PermissionCode, RoleCode } from '../platform/platform.types.js';

export interface RoleDefinition {
  code: RoleCode;
  label: string;
  description: string;
  permissions: PermissionCode[];
}

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  'parish.dashboard.view': 'Consulter le tableau de bord paroissial',
  'parish.users.view': 'Consulter les utilisateurs de la paroisse',
  'parish.users.manage': 'Créer, rattacher et suspendre les utilisateurs paroissiaux',
  'parish.roles.view': 'Consulter les rôles et permissions',
  'parish.roles.manage': 'Attribuer et retirer des rôles cumulés',
  'parish.settings.view': 'Consulter les informations et paramètres paroissiaux',
  'parish.settings.manage': 'Modifier les informations pratiques et chapelles',
  'parish.masses.view': 'Consulter le calendrier des messes',
  'parish.masses.manage': 'Créer et modifier les messes et célébrations',
  'parish.intentions.view': 'Consulter les intentions de messe',
  'parish.intentions.process': 'Traiter et programmer les intentions',
  'parish.intentions.approve': 'Valider ou refuser les intentions',
  'parish.intentions.celebrate': 'Enregistrer la célébration effective des intentions',
  'parish.announcements.view': 'Consulter les annonces paroissiales',
  'parish.announcements.publish': 'Publier et modifier les annonces',
  'parish.announcements.approve': 'Approuver les annonces avant publication',
  'parish.reports.view': 'Consulter les statistiques et rapports paroissiaux',
  'parish.audit.view': 'Consulter le journal historique de la paroisse',
};

export const ROLE_CATALOG: Record<RoleCode, RoleDefinition> = {
  PARISH_ADMIN: {
    code: 'PARISH_ADMIN',
    label: 'Administrateur paroissial',
    description:
      'Gère les utilisateurs, les rôles cumulés, les accès et les informations de sa paroisse.',
    permissions: [
      'parish.dashboard.view',
      'parish.users.view',
      'parish.users.manage',
      'parish.roles.view',
      'parish.roles.manage',
      'parish.settings.view',
      'parish.settings.manage',
      'parish.masses.view',
      'parish.intentions.view',
      'parish.announcements.view',
      'parish.reports.view',
      'parish.audit.view',
    ],
  },
  CURE: {
    code: 'CURE',
    label: 'Curé',
    description:
      'Responsable pastoral : supervise la vie paroissiale, valide intentions et annonces.',
    permissions: [
      'parish.dashboard.view',
      'parish.settings.view',
      'parish.masses.view',
      'parish.intentions.view',
      'parish.intentions.approve',
      'parish.intentions.celebrate',
      'parish.announcements.view',
      'parish.announcements.approve',
      'parish.reports.view',
      'parish.audit.view',
    ],
  },
  VICAIRE: {
    code: 'VICAIRE',
    label: 'Vicaire',
    description:
      'Accompagne le curé dans les célébrations et le suivi pastoral des intentions.',
    permissions: [
      'parish.dashboard.view',
      'parish.settings.view',
      'parish.masses.view',
      'parish.intentions.view',
      'parish.intentions.celebrate',
      'parish.announcements.view',
      'parish.reports.view',
    ],
  },
  SECRETAIRE: {
    code: 'SECRETAIRE',
    label: 'Secrétaire paroissiale',
    description:
      'Gère au quotidien messes, enregistrement et programmation des intentions, annonces et accueil.',
    permissions: [
      'parish.dashboard.view',
      'parish.settings.view',
      'parish.settings.manage',
      'parish.masses.view',
      'parish.masses.manage',
      'parish.intentions.view',
      'parish.intentions.process',
      'parish.intentions.approve',
      'parish.announcements.view',
      'parish.announcements.publish',
      'parish.reports.view',
    ],
  },
  RESPONSABLE_LITURGIQUE: {
    code: 'RESPONSABLE_LITURGIQUE',
    label: 'Responsable liturgique',
    description:
      'Organise les célébrations, le calendrier des messes et le suivi liturgique des intentions.',
    permissions: [
      'parish.dashboard.view',
      'parish.masses.view',
      'parish.masses.manage',
      'parish.intentions.view',
      'parish.intentions.process',
      'parish.intentions.celebrate',
      'parish.announcements.view',
    ],
  },
};

export const ALL_ROLE_CODES: RoleCode[] = Object.keys(ROLE_CATALOG) as RoleCode[];
