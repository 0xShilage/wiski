import 'server-only';
import { formatBRL as brl } from '@/lib/catalog/pricing';
import { HttpError } from '../http/problem';

/** Checkout errors (04 §10, 11 §2) with pt-BR copy in one place. */
export const OrderProblems = {
  itemUnavailable: () =>
    new HttpError(409, 'ITEM_UNAVAILABLE', 'Este título não está disponível para patrocínio.'),
  itemReserved: () =>
    new HttpError(
      409,
      'ITEM_RESERVED',
      'Alguém está pagando o Pix deste filme agora. Se não for concluído em até 35 minutos, ele volta a ficar disponível.',
    ),
  priceChanged: (breakdown: unknown) =>
    new HttpError(409, 'PRICE_CHANGED', 'O valor mudou. Confira o novo total antes de pagar.', {
      members: { breakdown },
    }),
  pendingOrderExists: () =>
    new HttpError(
      409,
      'PENDING_ORDER_EXISTS',
      'Você já tem um pedido aguardando o pagamento do Pix. Pague ou cancele esse pedido antes de fazer outro.',
    ),
  tooManyPendingFromIp: () =>
    new HttpError(
      429,
      'PENDING_ORDERS_IP_LIMIT',
      'Há pedidos demais aguardando pagamento desta rede. Tente de novo em alguns minutos.',
      { headers: { 'retry-after': '300' } },
    ),
  contactEmailRequired: () =>
    new HttpError(422, 'VALIDATION_FAILED', 'Alguns campos estão inválidos.', {
      errors: [{ path: 'contactEmail', message: 'Informe um e-mail para receber o comprovante.' }],
    }),
  idempotencyKeyRequired: () =>
    new HttpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Requisição sem identificador. Recarregue a página e tente de novo.',
    ),
  idempotencyConflict: () =>
    new HttpError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'Este pedido já foi enviado com outros dados. Recarregue a página e tente de novo.',
    ),
  pixUnavailable: () =>
    new HttpError(
      503,
      'PIX_UNAVAILABLE',
      'Não foi possível gerar o Pix agora. Nada foi cobrado — tente de novo em instantes.',
    ),
  campaignClosed: () =>
    new HttpError(409, 'CAMPAIGN_CLOSED', 'Esta campanha não está recebendo contribuições agora.'),
  amountAboveRemaining: (remainingCents: number) =>
    new HttpError(
      409,
      'AMOUNT_ABOVE_REMAINING',
      remainingCents === 0
        ? 'Os Pix aguardando pagamento já completam a meta. Se algum não for pago, abre espaço de novo.'
        : remainingCents >= 1000
          ? `Escolha até ${brl(remainingCents - 500)} ou exatamente ${brl(remainingCents)} (o que falta para a meta), para não sobrar menos de R$ 5,00.`
          : `Faltam ${brl(remainingCents)} para a meta: contribua com exatamente esse valor.`,
      { members: { remainingCents } },
    ),
  notCancellable: () =>
    new HttpError(
      409,
      'ORDER_NOT_CANCELLABLE',
      'Só pedidos aguardando pagamento podem ser cancelados.',
    ),
  alreadyClaimed: () =>
    new HttpError(409, 'ORDER_ALREADY_CLAIMED', 'Este pedido já está vinculado a uma conta.'),
};
