import { PAYMENT_SIMULATION_CONFIG } from '../payment.config.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import type {
  PaymentExecutionInput,
  PaymentExecutionResult,
  PaymentProvider,
} from './payment-provider.interface.js';
import type { PaymentStatus } from '../../platform/platform.types.js';

export class MoovMoneyPaymentProvider implements PaymentProvider {
  readonly code = 'MOOV_MONEY' as const;
  readonly displayName = 'Moov Money';
  readonly isSimulationMode = PAYMENT_SIMULATION_CONFIG.simulationMode;
  private readonly mock = new MockPaymentProvider('MOOV_MONEY');

  simulatePayment(input: PaymentExecutionInput): PaymentExecutionResult {
    if (!this.isSimulationMode) {
      throw new Error('Intégration Moov Money réelle non activée : mode simulation requis.');
    }
    return this.mock.simulatePayment(input);
  }

  verifyPayment(transactionReference: string, currentStatus: PaymentStatus) {
    return this.mock.verifyPayment(transactionReference, currentStatus);
  }
}
