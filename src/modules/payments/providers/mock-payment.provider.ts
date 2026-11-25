import type {
  PaymentProviderCode,
  PaymentStatus,
} from '../../platform/platform.types.js';
import { PAYMENT_PROVIDERS_META } from '../payment.config.js';
import type {
  PaymentExecutionInput,
  PaymentExecutionResult,
  PaymentProvider,
  PaymentSimulationStep,
} from './payment-provider.interface.js';

export class MockPaymentProvider implements PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly displayName: string;
  readonly isSimulationMode = true;

  constructor(code: PaymentProviderCode) {
    this.code = code;
    this.displayName = PAYMENT_PROVIDERS_META[code].name;
  }

  simulatePayment(input: PaymentExecutionInput): PaymentExecutionResult {
    const now = new Date().toISOString();
    const steps: PaymentSimulationStep[] = [
      {
        stepKey: 'INITIALIZED',
        label: `Initialisation locale de la demande (${input.transactionReference})`,
        completedAt: now,
      },
      {
        stepKey: 'OPERATOR_DISPATCH_SIMULATED',
        label: `Demande de confirmation simulée envoyée vers ${this.displayName}`,
        completedAt: now,
      },
    ];

    if (input.scenario === 'SUCCESS') {
      steps.push(
        {
          stepKey: 'VALIDATION_SIMULATED',
          label: `Validation simulée reçue pour le numéro ${input.phone}`,
          completedAt: now,
        },
        {
          stepKey: 'FINALIZED',
          label: `Paiement simulé confirmé (${input.amount} ${input.currency})`,
          completedAt: now,
        }
      );
      return {
        status: 'SUCCESS',
        confirmedAt: now,
        failureReason: null,
        operatorMessage: `Transaction simulée confirmée via ${this.displayName}.`,
        steps,
      };
    }

    if (input.scenario === 'FAILED') {
      const reason = `Paiement refusé en mode simulation (${this.displayName} : solde ou autorisation simulée insuffisante).`;
      steps.push({
        stepKey: 'FAILED',
        label: reason,
        completedAt: now,
      });
      return {
        status: 'FAILED',
        confirmedAt: null,
        failureReason: reason,
        operatorMessage: reason,
        steps,
      };
    }

    if (input.scenario === 'CANCELLED') {
      const reason = `Transaction annulée par le fidèle en mode simulation (${this.displayName}).`;
      steps.push({
        stepKey: 'CANCELLED',
        label: reason,
        completedAt: now,
      });
      return {
        status: 'CANCELLED',
        confirmedAt: null,
        failureReason: reason,
        operatorMessage: reason,
        steps,
      };
    }

    const pendingMsg = `Paiement en attente de confirmation simulée auprès de ${this.displayName}.`;
    steps.push({
      stepKey: 'PENDING',
      label: pendingMsg,
      completedAt: now,
    });
    return {
      status: 'PENDING',
      confirmedAt: null,
      failureReason: null,
      operatorMessage: pendingMsg,
      steps,
    };
  }

  verifyPayment(transactionReference: string, currentStatus: PaymentStatus) {
    return {
      transactionReference,
      status: currentStatus,
      simulationMode: true as const,
    };
  }
}
