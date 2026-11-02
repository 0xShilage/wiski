'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { Problem } from '@/lib/api-fetch';
import { confirmPresence } from '@/lib/step-up-client';
import {
  disableTotp,
  enableTotp,
  regenerateRecoveryCodes,
  startTotpSetup,
  type TotpSetup,
} from '@/lib/mfa-client';

type Props = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryLeft: number;
  verified: boolean;
  stepUpUrl: string;
};

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));

/** The QR code, drawn as one SVG path (no data URL, no inline style). */
function QrCode({ qr }: { qr: TotpSetup['qr'] }) {
  return (
    <svg
      className="wf-qr"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label="QR code para o app autenticador"
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.path} fill="#000000" />
    </svg>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Wiski — códigos de recuperação (cada um funciona uma vez)\n\n${codes.join('\n')}\n`;
  return (
    <div className="wf-recovery space-y-3" role="region" aria-label="Códigos de recuperação">
      <p className="wf-notice">
        Guarde estes 6 códigos num lugar seguro (gerenciador de senhas ou papel). Cada um abre o
        painel uma vez se você perder o celular. Eles não aparecem de novo.
      </p>
      <ol className="wf-recovery__list">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="wf-btn wf-btn--ghost wf-btn--sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setSaved(true);
          }}
        >
          Copiar
        </button>
        <a
          className="wf-btn wf-btn--ghost wf-btn--sm"
          download="wiski-codigos-de-recuperacao.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          onClick={() => setSaved(true)}
        >
          Baixar .txt
        </a>
      </div>
      <label className="wf-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Guardei os códigos</span>
      </label>
      <button type="button" className="wf-btn wf-btn--neon" disabled={!saved} onClick={onDone}>
        Concluir
      </button>
    </div>
  );
}

/**
 * /perfil/seguranca › App autenticador: set up (QR → first code → 6 recovery codes), new recovery
 * codes, turn off. Setting up and removing ask for a fresh Google login.
 */
export function TotpPanel({ enabled, enabledAt, recoveryLeft, verified, stepUpUrl }: Props) {
  const router = useRouter();
  const id = useId();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handle(problem: Problem) {
    if (problem.code === 'STEP_UP_REQUIRED') {
      if (await confirmPresence({ ...problem, stepUpUrl: problem.stepUpUrl ?? stepUpUrl })) {
        setMsg({ ok: true, text: 'Confirmado. Toque no botão de novo para concluir.' });
      }
      return;
    }
    setMsg({ ok: false, text: problem.detail });
  }

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          setSetup(null);
          router.refresh();
        }}
      />
    );
  }

  if (setup) {
    return (
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          const r = await enableTotp(code);
          setBusy(false);
          if (r.ok) setCodes(r.data.recoveryCodes);
          else {
            setCode('');
            void handle(r.problem);
          }
        }}
      >
        <ol className="wf-steps">
          <li>
            Abra o app autenticador (Google Authenticator, Microsoft Authenticator, 1Password,
            Aegis…) e escaneie o QR code.
          </li>
          <li>Digite o código de 6 dígitos que aparecer no app.</li>
        </ol>
        <div className="wf-qr-wrap">
          <QrCode qr={setup.qr} />
          <p className="text-sm text-fg-muted">
            Não consegue escanear? Digite esta chave no app:
            <br />
            <code className="wf-secret">{setup.secret}</code>
          </p>
        </div>
        <label className="wf-field" htmlFor={`${id}-code`}>
          <span>Código de 6 dígitos</span>
          <input
            id={`${id}-code`}
            className="wf-input wf-otp"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            {busy ? 'Conferindo…' : 'Ativar'}
          </button>
          <button type="button" className="wf-btn wf-btn--ghost" onClick={() => setSetup(null)}>
            Cancelar
          </button>
        </div>
        {msg ? (
          <p role="alert" className="text-danger">
            {msg.text}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {enabled ? (
        <>
          <p className="text-success" role="status">
            Ativado{enabledAt ? ` em ${fmt(enabledAt)}` : ''}. Códigos de recuperação restantes:{' '}
            {recoveryLeft} de 6.
          </p>
          {recoveryLeft <= 2 ? (
            <p className="wf-notice">
              Restam poucos códigos de recuperação. Gere um conjunto novo.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="wf-btn wf-btn--ghost"
              disabled={busy || !verified}
              onClick={async () => {
                if (!window.confirm('Gerar 6 códigos novos? Os antigos param de funcionar.'))
                  return;
                setBusy(true);
                setMsg(null);
                const r = await regenerateRecoveryCodes();
                setBusy(false);
                if (r.ok) setCodes(r.data.recoveryCodes);
                else void handle(r.problem);
              }}
            >
              Gerar novos códigos de recuperação
            </button>
            <button
              type="button"
              className="wf-btn wf-btn--danger"
              disabled={busy || !verified}
              onClick={async () => {
                if (
                  !window.confirm(
                    'Desativar o app autenticador? Sem outra forma de verificação, o painel vai pedir para ativar de novo.',
                  )
                )
                  return;
                setBusy(true);
                setMsg(null);
                const r = await disableTotp();
                setBusy(false);
                if (r.ok) {
                  setMsg({ ok: true, text: 'App autenticador desativado.' });
                  router.refresh();
                } else void handle(r.problem);
              }}
            >
              Desativar
            </button>
          </div>
          {!verified ? (
            <p className="text-sm text-fg-muted">
              Confirme a verificação acima para gerar códigos ou desativar.
            </p>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className="wf-btn wf-btn--neon"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            const r = await startTotpSetup();
            setBusy(false);
            if (r.ok) setSetup(r.data);
            else void handle(r.problem);
          }}
        >
          Configurar app autenticador
        </button>
      )}
      {msg ? (
        <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-success' : 'text-danger'}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
