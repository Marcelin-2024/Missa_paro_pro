import type {
  PaymentProviderCode,
  PaymentScenario,
  PaymentStatus,
} from '../../platform/platform.types.js';

export interface PaymentSimulationStep {
  stepKey: string;
  label: string;
  completedAt: string;
}

export interface PaymentExecutionInput {
  paymentId: string;
  transactionReference: string;
  intentionId: string;
  parishId: string;
  amount: number;
  currency: 'XOF';
  phone: string;
  scenario: PaymentScenario;
  attemptNumber: number;
}

export interface PaymentExecutionResult {
  status: PaymentStatus;
  confirmedAt: string | null;
  failureReason: string | null;
  operatorMessage: string;
  steps: PaymentSimulationStep[];
}

export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly displayName: string;
  readonly isSimulationMode: boolean;
  simulatePayment(input: PaymentExecutionInput): PaymentExecutionResult;
  verifyPayment(transactionReference: string, currentStatus: PaymentStatus): {
    transactionReference: string;
    status: PaymentStatus;
    simulationMode: true;
  };
}
