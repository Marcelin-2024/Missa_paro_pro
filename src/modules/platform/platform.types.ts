export type ParishStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export type UserAccountStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export type RoleAssignmentStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export type IntentionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'SCHEDULED'
  | 'CELEBRATED'
  | 'REJECTED'
  | 'CANCELLED';

export type RoleCode =
  | 'PARISH_ADMIN'
  | 'CURE'
  | 'VICAIRE'
  | 'SECRETAIRE'
  | 'RESPONSABLE_LITURGIQUE';

export type PaymentProviderCode = 'WAVE' | 'ORANGE_MONEY' | 'MTN_MONEY' | 'MOOV_MONEY';

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

export type PaymentScenario = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING';

export type PaymentEventType =
  | 'CREATED'
  | 'OPERATOR_REQUEST_SENT'
  | 'OPERATOR_VALIDATION_RECEIVED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_PENDING'
  | 'RETRY_INITIATED'
  | 'EXCEPTIONAL_CORRECTION';

export type PermissionCode =
  | 'parish.dashboard.view'
  | 'parish.users.view'
  | 'parish.users.manage'
  | 'parish.roles.view'
  | 'parish.roles.manage'
  | 'parish.settings.view'
  | 'parish.settings.manage'
  | 'parish.masses.view'
  | 'parish.masses.manage'
  | 'parish.intentions.view'
  | 'parish.intentions.process'
  | 'parish.intentions.approve'
  | 'parish.intentions.celebrate'
  | 'parish.announcements.view'
  | 'parish.announcements.publish'
  | 'parish.announcements.approve'
  | 'parish.reports.view'
  | 'parish.audit.view'
  | 'parish.payments.view'
  | 'parish.payments.statistics';

export interface UserEntity {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  passwordHash: string | null;
  accountType: 'SUPER_ADMIN' | 'PARISH_STAFF' | 'FIDELE';
  isSuperAdmin: boolean;
  status: UserAccountStatus;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: string | null;
  activationTokenHash: string | null;
  activationExpiresAt: string | null;
  preferredProvinceId?: string;
  preferredDioceseId?: string;
  preferredParishId?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface ParishEntity {
  id: string;
  directoryParishId: string | null;
  provinceId: string;
  provinceName: string;
  dioceseId: string;
  dioceseName: string;
  name: string;
  location: string;
  status: ParishStatus;
  phone: string;
  email: string;
  address: string;
  massScheduleSummary: string;
  chapelsEnabled: boolean;
  chapels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ParishMembershipEntity {
  id: string;
  userId: string;
  parishId: string;
  status: MembershipStatus;
  titleLabel: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface MembershipRoleEntity {
  id: string;
  membershipId: string;
  parishId: string;
  userId: string;
  roleCode: RoleCode;
  status: RoleAssignmentStatus;
  assignedBy: string;
  assignedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface IntentionEntity {
  id: string;
  trackingRef: string;
  parishId: string;
  parishName: string;
  provinceId: string;
  dioceseId: string;
  requesterUserId: string | null;
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string;
  intentionType?: string;
  amount?: number;
  currency?: 'XOF';
  objet: string;
  details: string;
  requestedAt: string;
  desiredDate: string | null;
  messeId: string | null;
  status: IntentionStatus;
  internalComment: string;
  processedAt: string | null;
  processedBy: string | null;
  celebratedAt: string | null;
  celebratedBy: string | null;
  updatedAt: string;
}

export interface PaymentEntity {
  id: string;
  transactionReference: string;
  intentionId: string;
  intentionTrackingRef: string;
  parishId: string;
  parishName: string;
  faithfulUserId: string | null;
  faithfulName: string;
  faithfulPhone: string;
  provider: PaymentProviderCode;
  amount: number;
  currency: 'XOF';
  status: PaymentStatus;
  simulationMode: true;
  scenario: PaymentScenario;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  failureReason: string | null;
  attemptNumber: number;
}

export interface PaymentEventEntity {
  id: string;
  paymentId: string;
  parishId: string;
  eventType: PaymentEventType;
  previousStatus: PaymentStatus | null;
  newStatus: PaymentStatus;
  description: string;
  createdAt: string;
}

export interface MesseEntity {
  id: string;
  parishId: string;
  date: string;
  horaire: string;
  celebrant: string;
  type: string;
  statut: 'A venir' | 'Passée' | 'Annulée';
  createdBy: string;
  createdAt: string;
}

export interface AnnonceEntity {
  id: string;
  parishId: string;
  type: 'evenement' | 'Deces' | 'Communique' | 'Solennite';
  titre: string;
  dateAnnonce: string;
  contenu: string;
  imageUrl?: string;
  statut: 'PUBLISHED' | 'PENDING_APPROVAL' | 'ARCHIVED';
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
}

export interface AuditLogEntity {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  scope: 'GLOBAL' | 'PARISH' | 'PUBLIC';
  parishId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface NotificationEntity {
  id: string;
  userId: string | null;
  parishId: string | null;
  trackingRef: string | null;
  audience: 'PARISH_ADMIN' | 'PARISH_STAFF' | 'FIDELE' | 'SUPER_ADMIN';
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface PlatformSettingsEntity {
  platformName: string;
  supportEmail: string;
  tempPasswordTtlHours: number;
  activationLinkTtlHours: number;
  allowPublicFideleSignup: boolean;
  requireCureAnnouncementApproval: boolean;
}

export interface PlatformState {
  version: number;
  superAdminClaimed: boolean;
  settings: PlatformSettingsEntity;
  users: UserEntity[];
  parishes: ParishEntity[];
  memberships: ParishMembershipEntity[];
  membershipRoles: MembershipRoleEntity[];
  intentions: IntentionEntity[];
  payments: PaymentEntity[];
  paymentEvents: PaymentEventEntity[];
  messes: MesseEntity[];
  annonces: AnnonceEntity[];
  auditLogs: AuditLogEntity[];
  notifications: NotificationEntity[];
}
