import type { PaymentProviderCode, PaymentScenario, PaymentStatus } from '../platform/platform.types.js';

export const PAYMENT_SIMULATION_CONFIG = {
  simulationMode: true as const,
  currency: 'XOF' as const,
  defaultAmountXof: 2000,
  minAmountXof: 500,
  maxAmountXof: 500000,
  simulatedDelayMs: 350,
};

export interface IntentionTariffItem {
  code: string;
  label: string;
  amount: number;
  currency: 'XOF';
}

export const INTENTION_TARIFFS: IntentionTariffItem[] = [
  { code: 'ACTION_GRACE', label: 'Action de grâce', amount: 2000, currency: 'XOF' },
  { code: 'REPOS_AME', label: 'Repos de l’âme', amount: 3000, currency: 'XOF' },
  { code: 'GUERISON', label: 'Guérison & réconfort', amount: 2500, currency: 'XOF' },
  { code: 'PROTECTION', label: 'Protection & bénédiction', amount: 2000, currency: 'XOF' },
  { code: 'NEUVAINE', label: 'Messe neuvaine / Spéciale', amount: 5000, currency: 'XOF' },
  { code: 'AUTRE', label: 'Autre intention de prière', amount: 2000, currency: 'XOF' },
];

export interface PaymentProviderMeta {
  code: PaymentProviderCode;
  name: string;
  shortName: string;
  badgeText: string;
  brandClass: string;
  phoneHint: string;
  ussdHint: string;
  simulationNotice: string;
  simulationAvailable: true;
}

export const PAYMENT_PROVIDERS_META: Record<PaymentProviderCode, PaymentProviderMeta> = {
  WAVE: {
    code: 'WAVE',
    name: 'Wave',
    shortName: 'Wave',
    badgeText: 'W',
    brandClass: 'provider-wave',
    phoneHint: '+225 07 / 05 / 01 XX XX XX XX',
    ussdHint: 'Notification push simulée dans l’application Wave',
    simulationNotice: 'Disponible en mode simulation',
    simulationAvailable: true,
  },
  ORANGE_MONEY: {
    code: 'ORANGE_MONEY',
    name: 'Orange Money',
    shortName: 'Orange Money',
    badgeText: 'OM',
    brandClass: 'provider-orange',
    phoneHint: '+225 07 XX XX XX XX',
    ussdHint: 'Validation USSD #144# simulée localement',
    simulationNotice: 'Disponible en mode simulation',
    simulationAvailable: true,
  },
  MTN_MONEY: {
    code: 'MTN_MONEY',
    name: 'MTN Mobile Money',
    shortName: 'MTN MoMo',
    badgeText: 'MTN',
    brandClass: 'provider-mtn',
    phoneHint: '+225 05 XX XX XX XX',
    ussdHint: 'Validation USSD *133# simulée localement',
    simulationNotice: 'Disponible en mode simulation',
    simulationAvailable: true,
  },
  MOOV_MONEY: {
    code: 'MOOV_MONEY',
    name: 'Moov Money',
    shortName: 'Moov Money',
    badgeText: 'MOOV',
    brandClass: 'provider-moov',
    phoneHint: '+225 01 XX XX XX XX',
    ussdHint: 'Validation USSD *155# simulée localement',
    simulationNotice: 'Disponible en mode simulation',
    simulationAvailable: true,
  },
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'En attente',
  SUCCESS: 'Réussi',
  FAILED: 'Échoué',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
};

export const PAYMENT_SCENARIO_LABELS: Record<PaymentScenario, string> = {
  SUCCESS: 'Paiement réussi',
  FAILED: 'Paiement refusé',
  CANCELLED: 'Paiement annulé',
  PENDING: 'Paiement en attente',
};

export function resolveIntentionTariff(intentionType?: string, objet?: string): IntentionTariffItem {
  const cleanType = String(intentionType || '').trim().toUpperCase();
  const matchedByCode = INTENTION_TARIFFS.find((t) => t.code === cleanType);
  if (matchedByCode) return matchedByCode;

  const normalizedObjet = String(objet || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalizedObjet.includes('neuvaine')) return INTENTION_TARIFFS[4];
  if (normalizedObjet.includes('repos') || normalizedObjet.includes('ame') || normalizedObjet.includes('defunt')) {
    return INTENTION_TARIFFS[1];
  }
  if (normalizedObjet.includes('guerison') || normalizedObjet.includes('malad')) return INTENTION_TARIFFS[2];
  if (normalizedObjet.includes('protection') || normalizedObjet.includes('benediction')) return INTENTION_TARIFFS[3];
  if (normalizedObjet.includes('grace') || normalizedObjet.includes('action')) return INTENTION_TARIFFS[0];

  return INTENTION_TARIFFS[5];
}
