import { route } from '@/server/http/route';
import { testSponsorshipAlert } from '@/server/overlay/state';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/alerts/test — "Testar alerta": a sample "Novo patrocínio" (not in chat). */
export const POST = route<'moderator'>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ audit }) => {
    const r = await testSponsorshipAlert();
    await audit({
      action: 'alerts.test',
      targetType: 'AppSetting',
      targetId: 'alerts',
      metadata: r,
    });
    return r;
  },
);
