'use client';
import { useId, useState } from 'react';
import { apiFetch, type Problem } from '@/lib/api-fetch';

/**
 * Seus dados (LGPD, Phase 4): download everything we hold as JSON, or erase the account. Erasing
 * needs a fresh Google login (step-up) and typing the username; paid orders stay anonymised
 * for the accounting retention period.
 */
export function DataTools({ username }: { username: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function erase(e: React.FormEvent) {
    e.preventDefault();
    if (busy || confirm !== username) return;
    setBusy(true);
    setProblem(null);
    const r = await apiFetch('/api/v1/me/erase', {
      method: 'POST',
      body: { confirmUsername: confirm },
    });
    setBusy(false);
    if (r.ok) {
      window.location.assign(new URL('/', window.location.origin).href);
      return;
    }
    if (r.problem.code === 'STEP_UP_REQUIRED' && r.problem.stepUpUrl) {
      window.location.assign(new URL(r.problem.stepUpUrl, window.location.origin).href);
      return;
    }
    setProblem(r.problem);
  }

  return (
    <div className="space-y-4">
      <p className="text-fg/90">
        Baixe uma cópia de tudo o que guardamos sobre você (perfil, avaliações, curtidas, denúncias,
        pedidos e sessões) em um arquivo JSON.
      </p>
      <a href="/api/v1/me/export" className="wf-btn wf-btn--ghost" download>
        Baixar meus dados
      </a>

      {open ? (
        <form onSubmit={erase} className="wf-co space-y-3">
          <p role="note" className="wf-notice">
            Apagar a conta remove suas avaliações, curtidas, denúncias e passkeys e encerra todas as
            sessões. Pedidos pagos ficam guardados sem seu nome pelo prazo exigido por lei. Seu nome
            de usuário fica reservado por 30 dias. Não dá para desfazer.
          </p>
          <label className="wf-field" htmlFor={`${id}-confirm`}>
            <span>
              Para confirmar, digite <strong>{username}</strong>
            </span>
            <input
              id={`${id}-confirm`}
              className="wf-input"
              autoComplete="off"
              value={confirm}
              maxLength={40}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {problem ? (
            <p className="wf-toast wf-toast--err" role="alert">
              {problem.detail}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="wf-btn wf-btn--danger"
              disabled={busy || confirm !== username}
            >
              {busy ? 'Apagando…' : 'Apagar minha conta'}
            </button>
            <button type="button" className="wf-btn wf-btn--ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
          <p className="text-xs text-fg-muted">
            Se o seu último login com o Google tiver mais de 10 minutos, vamos pedir para entrar de
            novo antes de apagar.
          </p>
        </form>
      ) : (
        <button type="button" className="wf-linkbtn text-sm" onClick={() => setOpen(true)}>
          Quero apagar minha conta
        </button>
      )}
    </div>
  );
}
