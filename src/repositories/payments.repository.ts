import { getAdminDb } from '../config/firebaseAdmin.js';
import type { PaymentEntity, PaymentEventEntity } from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

function paymentsCol() {
  return getAdminDb().collection(COLLECTIONS.PAYMENTS);
}
function eventsCol() {
  return getAdminDb().collection(COLLECTIONS.PAYMENT_EVENTS);
}

export async function listPaymentsRepo(parishId?: string): Promise<PaymentEntity[]> {
  const snap = parishId
    ? await paymentsCol().where('parishId', '==', parishId).get()
    : await paymentsCol().get();
  return snap.docs
    .map((d) => d.data() as PaymentEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPaymentsByIntentionRepo(intentionId: string): Promise<PaymentEntity[]> {
  const snap = await paymentsCol().where('intentionId', '==', intentionId).get();
  return snap.docs
    .map((d) => d.data() as PaymentEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findPaymentByIdOrRefRepo(idOrRef: string): Promise<PaymentEntity | null> {
  const clean = String(idOrRef || '').trim();
  if (!clean) return null;

  const byId = await paymentsCol().doc(clean).get();
  if (byId.exists) return byId.data() as PaymentEntity;

  const byRef = await paymentsCol()
    .where('transactionReference', '==', clean.toUpperCase())
    .limit(1)
    .get();
  if (!byRef.empty) return byRef.docs[0].data() as PaymentEntity;

  const byExactRef = await paymentsCol().where('transactionReference', '==', clean).limit(1).get();
  return byExactRef.empty ? null : (byExactRef.docs[0].data() as PaymentEntity);
}

export async function listPaymentsByIntentionTrackingRefRepo(
  trackingRef: string
): Promise<PaymentEntity[]> {
  const cleanRef = String(trackingRef || '').trim().toUpperCase();
  if (!cleanRef) return [];
  const snap = await paymentsCol().where('intentionTrackingRef', '==', cleanRef).get();
  return snap.docs
    .map((d) => d.data() as PaymentEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPaymentEventsByPaymentRepo(
  paymentId: string
): Promise<PaymentEventEntity[]> {
  const snap = await eventsCol().where('paymentId', '==', paymentId).get();
  return snap.docs
    .map((d) => d.data() as PaymentEventEntity)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function commitSimulatedPaymentTransaction(params: {
  intentionId: string;
  isRetry: boolean;
  supersededPendingPaymentId?: string;
  supersededCancelEvent?: PaymentEventEntity;
  buildRecord: (attemptNumber: number) => {
    payment: PaymentEntity;
    events: PaymentEventEntity[];
  };
}): Promise<
  | { ok: true; payment: PaymentEntity; events: PaymentEventEntity[] }
  | { ok: false; status: number; error: string }
> {
  const db = getAdminDb();

  return db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(
      paymentsCol().where('intentionId', '==', params.intentionId)
    );
    const existingPayments = existingSnap.docs.map((d) => d.data() as PaymentEntity);

    const alreadyPaid = existingPayments.some((p) => p.status === 'SUCCESS');
    if (alreadyPaid) {
      return {
        ok: false as const,
        status: 409,
        error: 'Cette intention a déjà fait l’objet d’un paiement réussi. Double facturation bloquée.',
      };
    }

    if (!params.isRetry) {
      const activePending = existingPayments.find((p) => p.status === 'PENDING');
      if (activePending) {
        return {
          ok: false as const,
          status: 409,
          error: `Une transaction en attente (${activePending.transactionReference}) existe déjà pour cette intention. Utilisez la relance de paiement.`,
        };
      }
    }

    if (params.supersededPendingPaymentId && params.supersededCancelEvent) {
      const prevRef = paymentsCol().doc(params.supersededPendingPaymentId);
      tx.update(prevRef, {
        status: 'CANCELLED',
        updatedAt: params.supersededCancelEvent.createdAt,
        failureReason: 'Remplacée par une nouvelle tentative de paiement simulé.',
      });
      tx.set(
        eventsCol().doc(params.supersededCancelEvent.id),
        stripUndefined({ ...params.supersededCancelEvent })
      );
    }

    const attemptNumber = existingPayments.length + 1;
    const { payment, events } = params.buildRecord(attemptNumber);

    tx.set(paymentsCol().doc(payment.id), stripUndefined({ ...payment }));
    for (const evt of events) {
      tx.set(eventsCol().doc(evt.id), stripUndefined({ ...evt }));
    }

    return { ok: true as const, payment, events };
  });
}

export async function commitPaymentCorrectionTransaction(
  payment: PaymentEntity,
  event: PaymentEventEntity
): Promise<void> {
  const db = getAdminDb();
  await db.runTransaction(async (tx) => {
    tx.set(paymentsCol().doc(payment.id), stripUndefined({ ...payment }));
    tx.set(eventsCol().doc(event.id), stripUndefined({ ...event }));
  });
}
