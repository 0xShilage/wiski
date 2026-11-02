'use client';
import { useId, useRef, useState } from 'react';
import { Turnstile, type TurnstileHandle } from '@/components/checkout/Turnstile';
import { apiFetch, type Problem } from '@/lib/api-fetch';

/**
 * Contato (Phase 4): brands and partners. Turnstile + a hidden honeypot field + the sealed form
 * token issued with the page (minimum fill time). The server sanitises everything to plain text.
 */
export function ContactForm({ siteKey, formToken }: { siteKey: string; formToken: string }) {
  const id = useId();
  const [f, setF] = useState({
    name: '',
    email: '',
    company: '',
    subject: '',
    body: '',
    website: '',
  });
  const [token, setToken] = useState<string | null>(null);
  const [captchaDown, setCaptchaDown] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  const err = (path: string) => problem?.errors?.find((e) => e.path === path)?.message;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    setBusy(true);
    setProblem(null);
    const r = await apiFetch('/api/v1/contact', {
      method: 'POST',
      headers: { 'x-turnstile-token': token },
      body: {
        name: f.name,
        email: f.email,
        ...(f.company.trim() ? { company: f.company } : {}),
        subject: f.subject,
        body: f.body,
        website: f.website,
        formToken,
      },
    });
    setBusy(false);
    if (r.ok) {
      setSent(true);
      return;
    }
    setProblem(r.problem);
    turnstile.current?.reset();
  }

  if (sent) {
    return (
      <p role="status" className="wf-toast wf-toast--ok">
        Mensagem enviada! A gente responde pelo e-mail que você informou.
      </p>
    );
  }

  const input = (
    key: 'name' | 'email' | 'company' | 'subject',
    label: string,
    opts: { type?: string; max: number; required?: boolean; auto?: string },
  ) => (
    <label className="wf-field" htmlFor={`${id}-${key}`}>
      <span>{label}</span>
      <input
        id={`${id}-${key}`}
        className="wf-input"
        type={opts.type ?? 'text'}
        maxLength={opts.max}
        required={opts.required ?? true}
        autoComplete={opts.auto}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        aria-invalid={err(key) ? 'true' : undefined}
      />
      {err(key) ? <span className="wf-hint wf-hint--err">{err(key)}</span> : null}
    </label>
  );

  return (
    <form className="wf-co space-y-4" onSubmit={submit}>
      {input('name', 'Seu nome', { max: 80, auto: 'name' })}
      {input('email', 'E-mail para resposta', { type: 'email', max: 254, auto: 'email' })}
      {input('company', 'Empresa ou marca (opcional)', {
        max: 80,
        required: false,
        auto: 'organization',
      })}
      {input('subject', 'Assunto', { max: 120 })}
      <label className="wf-field" htmlFor={`${id}-body`}>
        <span>Mensagem</span>
        <textarea
          id={`${id}-body`}
          className="wf-input"
          rows={7}
          maxLength={4000}
          required
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          aria-invalid={err('body') ? 'true' : undefined}
        />
        {err('body') ? <span className="wf-hint wf-hint--err">{err('body')}</span> : null}
      </label>
      {/* honeypot: hidden from people and assistive tech; bots fill it */}
      <div className="wf-hp" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Site</label>
        <input
          id={`${id}-website`}
          tabIndex={-1}
          autoComplete="off"
          value={f.website}
          onChange={(e) => setF({ ...f, website: e.target.value })}
        />
      </div>
      <Turnstile
        ref={turnstile}
        siteKey={siteKey}
        action="contact"
        onToken={(t) => {
          setToken(t);
          if (t) setCaptchaDown(false);
        }}
        onError={() => setCaptchaDown(true)}
      />
      {captchaDown ? (
        <p className="wf-hint wf-hint--err" role="alert">
          Não foi possível carregar a verificação anti-robô. Recarregue a página e tente de novo.
        </p>
      ) : null}
      {problem && !problem.errors?.length ? (
        <p className="wf-toast wf-toast--err" role="alert">
          {problem.detail}
        </p>
      ) : null}
      <button type="submit" className="wf-btn wf-btn--neon" disabled={busy || !token}>
        {busy ? 'Enviando…' : 'Enviar mensagem'}
      </button>
      <p className="text-xs text-fg-muted">
        Guardamos sua mensagem por até 12 meses só para responder e acompanhar a conversa. Veja a{' '}
        <a className="underline" href="/privacidade">
          Política de privacidade
        </a>
        .
      </p>
    </form>
  );
}
