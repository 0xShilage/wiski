import { z } from 'zod';

/**
 * Username rules (02 §2, 05 §5 impersonation): lowercase canonical ASCII [a-z0-9_]{3,20} (no
 * homoglyphs), reserved names, 30-day hold of released names (server side).
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Exact names that belong to the site, routes or roles. */
export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrador',
  'administrator',
  'root',
  'sistema',
  'system',
  'api',
  'www',
  'mail',
  'email',
  'suporte',
  'support',
  'ajuda',
  'help',
  'contato',
  'contact',
  'moderador',
  'moderadora',
  'moderator',
  'mod',
  'mods',
  'staff',
  'equipe',
  'oficial',
  'official',
  'streamer',
  'dono',
  'owner',
  'conta',
  'entrar',
  'sair',
  'login',
  'logout',
  'cadastro',
  'bem_vindo',
  'perfil',
  'patrocinar',
  'patrocinio',
  'pedido',
  'fila',
  'titulos',
  'avaliacoes',
  'midia_kit',
  'termos',
  'privacidade',
  'reembolso',
  'overlay',
  'null',
  'undefined',
  'anonimo',
  'anonymous',
  'usuario_removido',
  'deleted',
  'tmdb',
  'mercadopago',
  'pix',
  'google',
  'cloudflare',
]);

/** Fragments that impersonate the brand or staff anywhere in a name. */
export const RESERVED_FRAGMENTS = [
  'wiski',
  'admin',
  'moderad',
  'moderator',
  'suporte',
  'support',
  'oficial',
  'official',
  'staff',
];

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** pt-BR reason why a (normalised) username is not acceptable, or null when the format is fine. */
export function usernameRuleViolation(name: string): string | null {
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `Use de ${USERNAME_MIN} a ${USERNAME_MAX} caracteres.`;
  }
  if (!USERNAME_PATTERN.test(name)) return 'Use só letras minúsculas sem acento, números e _.';
  if (RESERVED_USERNAMES.has(name) || RESERVED_FRAGMENTS.some((f) => name.includes(f))) {
    return 'Esse nome é reservado.';
  }
  return null;
}

export const usernameSchema = z
  .string()
  .max(64)
  .transform(normalizeUsername)
  .refine((v) => usernameRuleViolation(v) === null, {
    message: 'Nome de usuário inválido ou reservado.',
  });
