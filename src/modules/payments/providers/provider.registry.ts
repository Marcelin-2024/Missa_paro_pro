import type { PaymentProviderCode } from '../../platform/platform.types.js';
import type { PaymentProvider } from './payment-provider.interface.js';
import { WavePaymentProvider } from './wave.provider.js';
import { OrangeMoneyPaymentProvider } from './orange-money.provider.js';
import { MtnMoneyPaymentProvider } from './mtn-money.provider.js';
import { MoovMoneyPaymentProvider } from './moov-money.provider.js';

const PROVIDERS: Record<PaymentProviderCode, PaymentProvider> = {
  WAVE: new WavePaymentProvider(),
  ORANGE_MONEY: new OrangeMoneyPaymentProvider(),
  MTN_MONEY: new MtnMoneyPaymentProvider(),
  MOOV_MONEY: new MoovMoneyPaymentProvider(),
};

export function getPaymentProvider(code: PaymentProviderCode): PaymentProvider {
  return PROVIDERS[code];
}

export function isValidPaymentProvider(value: unknown): value is PaymentProviderCode {
  return (
    typeof value === 'string' &&
    ['WAVE', 'ORANGE_MONEY', 'MTN_MONEY', 'MOOV_MONEY'].includes(value.trim().toUpperCase())
  );
}
