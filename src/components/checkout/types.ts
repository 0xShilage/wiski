/** Client-safe shapes shared by the checkout sheets and the order page. */
export type LegalVersions = { terms: string; privacy: string; refund: string };

export type CheckoutContext = {
  /** signed in with a username (onboarding done) */
  viewer: { username: string } | null;
  signedIn: boolean;
  turnstileSiteKey: string;
  legal: LegalVersions;
  /** Mercado Pago configured in this environment */
  payable: boolean;
};

export type QuoteLine = {
  kind: 'info' | 'base' | 'extra' | 'subtotal' | 'discount' | 'queueJump' | 'total';
  label: string;
  cents: number | null;
};

export type Quote = {
  item: { id: string; title: string; runtimeMinutes: number };
  breakdown: { lines: QuoteLine[]; totalCents: number };
  queueJump: { id: string; label: string; bps: number; placement: 'AHEAD_OF_REGULAR' | 'TOP' }[];
};

export type CheckoutResponse = {
  order: { id: string; publicCode: string; totalCents: number };
  accessToken: string;
};
