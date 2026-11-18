import 'server-only';
import type { ItemKind, ItemStatus } from '@/generated/prisma/enums';
import { db } from '../db';

/**
 * "Já assistiu fora da live?" (2026-11-10; published movies since 2026-11-18): whether a title can
 * go straight to Assistidos as watched by Iara on her own, and if not, why (shown in the editor's
 * Ações panel). A draft can. A published movie can while nobody is paying for it: no Pix pending
 * and no order other than expired, cancelled or refunded ones. Published series, franchises and
 * animes have a campaign, and anything sponsored, funded, watched or archived is past that point.
 */
export const ORDER_DONE = ['EXPIRED', 'CANCELLED', 'REFUNDED'] as const;

export function offStreamBlock(
  item: { kind: ItemKind; status: ItemStatus; reservedUntil: Date | null },
  openOrders: number,
  now = new Date(),
): string | null {
  switch (item.status) {
    case 'DRAFT':
      return null;
    case 'ACTIVE':
      if (item.kind !== 'MOVIE') {
        return 'Já tem campanha aberta: só um rascunho pode ir direto para Assistidos.';
      }
      if (item.reservedUntil && item.reservedUntil > now) {
        return 'Tem um Pix pendente agora. Espere ele pagar ou expirar.';
      }
      return openOrders > 0 ? 'Já tem um pedido de patrocínio.' : null;
    case 'SPONSORED':
    case 'FUNDED':
      return 'Já foi patrocinado: marque como assistido quando passar na live.';
    case 'WATCHED':
      return 'Já está em Assistidos.';
    case 'ARCHIVED':
      return 'Este título está arquivado.';
  }
}

/** Orders on the item that still mean money (anything but expired, cancelled or refunded). */
export function openOrderCount(itemId: string): Promise<number> {
  return db().order.count({ where: { itemId, status: { notIn: [...ORDER_DONE] } } });
}
