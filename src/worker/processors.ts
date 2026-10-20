import 'server-only';
import type { Job } from 'bullmq';
import { db } from '@/server/db';
import { sendOutbox, sweepOutbox } from '@/server/email/outbox';
import type { EmailJob, PaymentJob } from '@/server/jobs/queues';
import { logger } from '@/server/log';
import { recoverFailedCreate } from '@/server/orders/checkout';
import { cancelPixAtProvider, expireDueOrders } from '@/server/orders/lifecycle';
import { reconcile, syncMpOrder } from '@/server/payments/sync';

/**
 * Job processors (13 §3 step 9–10). Pure dispatch: each one reads the current state and is safe
 * to run twice. Throwing makes BullMQ retry with exponential backoff (attempts: 6).
 */
export async function processPayments(job: Job): Promise<unknown> {
  const j = { name: job.name, data: job.data } as PaymentJob;
  switch (j.name) {
    case 'payment.sync': {
      const outcome = await syncMpOrder(j.data.mpOrderId, j.data.source);
      if (j.data.webhookRequestId) {
        await db().webhookEvent.updateMany({
          where: { requestId: j.data.webhookRequestId },
          data: {
            outcome: outcome === 'foreign' ? 'IGNORED' : 'PROCESSED',
            processedAt: new Date(),
          },
        });
      }
      return outcome;
    }
    case 'payment.recover':
      return recoverFailedCreate(j.data.orderId);
    case 'payment.cancel':
      return cancelPixAtProvider(j.data.orderId);
    case 'payment.reconcile':
      return reconcile(j.data.sweep);
    case 'orders.expire':
      return expireDueOrders();
    default:
      logger.warn({ job: job.name }, 'unknown payments job');
      return null;
  }
}

export async function processEmail(job: Job): Promise<unknown> {
  const j = { name: job.name, data: job.data } as EmailJob;
  switch (j.name) {
    case 'email.send':
      return sendOutbox(j.data.outboxId);
    case 'email.sweep':
      return sweepOutbox();
    default:
      logger.warn({ job: job.name }, 'unknown email job');
      return null;
  }
}
