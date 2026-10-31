import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { contactInput } from '@/server/admin/input';
import { submitContact } from '@/server/contact/contact';

/** POST /api/v1/contact — brands and partners (Turnstile, honeypot, minimum fill time, 5/h · 20/day per IP). */
export const POST = route<'public', typeof contactInput>(
  {
    methods: ['POST'],
    access: 'public',
    rateLimit: [RL.contact, RL.contactDaily],
    turnstile: 'contact',
    body: contactInput,
  },
  async ({ body }) => Response.json(await submitContact(body), { status: 201 }),
);
