import { PAYMENT_SIMULATION_CONFIG } from '../payment.config.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import type {
  PaymentExecutionInput,
  PaymentExecutionResult,
  PaymentProvider,
} from './payment-provider.interface.js';
import type { PaymentStatus } from '../../platform/platform.types.js';

export class WavePaymentProvider implements PaymentProvider {
  readonly code = 'WAVE' as const;
  readonly displayName = 'Wave';
  readonly isSimulationMode = PAYMENT_SIMULATION_CONFIG.simulationMode;
  private readonly mock = new MockPaymentProvider('WAVE');

  simulatePayment(input: PaymentExecutionInput): PaymentExecutionResult {
    if (!this.isSimulationMode) {
      throw new Error('Intégration Wave réelle non activée : mode simulation requis.');
    }
    return this.mock.simulatePayment(input);
  }

  verifyPayment(transactionReference: string, currentStatus: PaymentStatus) {
    return this.mock.verifyPayment(transactionReference, currentStatus);
  }
}
