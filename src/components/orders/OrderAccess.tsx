'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

/**
 * /pedido/[code] without access yet: exchanges the link token from the fragment (`#t=…`, from the
 * receipt e-mail or the checkout) for the order cookie, then reloads. Without a valid token the
 * page says the same thing whether or not the order exists.
 */
export function OrderAccess({ code, signedIn }: { code: string; signedIn: boolean }) {
  const [state, setState] = useState<'checking' | 'denied'>('checking');

  useEffect(() => {
    const m = /(?:^#|&)t=([\w-]{43})(?:&|$)/.exec(window.location.hash);
    let cancelled = false;
    const run = async () => {
      if (m) {
        const res = await apiFetch<{ ok: true }>(`/api/v1/orders/${code}/access`, {
          method: 'POST',
          body: { token: m[1] },
        });
        if (cancelled) return;
        if (res.ok) {
          window.location.reload(); // the fragment stays; the page now renders the order
          return;
        }
      }
      if (!cancelled) setState('denied');
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state === 'checking') {
    return (
      <div className="wf-page wf-page--narrow">
        <p className="wf-muted" role="status">
          Abrindo o pedido…
        </p>
      </div>
    );
  }
  return (
    <div className="wf-page wf-page--narrow">
      <div className="wf-panel space-y-4">
        <h1 className="wf-h2">Não conseguimos abrir este pedido</h1>
        <p>
          Use o link completo do e-mail do comprovante, ou abra a página no mesmo navegador em que
          você fez o pedido.
        </p>
        {signedIn ? (
          <p>
            Compras vinculadas à sua conta ficam em{' '}
            <Link href="/perfil#minhas-compras" className="underline">
              Perfil › Minhas compras
            </Link>
            .
          </p>
        ) : (
          <p>
            Se a compra foi feita com a sua conta,{' '}
            <a href="/perfil" className="underline">
              entre com Google
            </a>{' '}
            para vê-la.
          </p>
        )}
      </div>
    </div>
  );
}
