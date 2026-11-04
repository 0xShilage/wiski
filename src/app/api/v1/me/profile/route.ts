import { z } from 'zod';
import { changeAvatar, changeUsername } from '@/server/auth/accounts';
import { setShowAchievements } from '@/server/community/achievements';
import { HttpError } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { avatarKeySchema } from '@/lib/avatars';
import { usernameSchema } from '@/lib/username';

/**
 * PATCH /api/v1/me/profile — avatar; username at most once per 30 days; whether badges show on the
 * public profile and in /ranking.
 */
export const PATCH = route(
  {
    methods: ['PATCH'],
    access: 'user',
    rateLimit: RL.profileWrite,
    body: z
      .object({
        username: usernameSchema.optional(),
        avatarKey: avatarKeySchema.optional(),
        showAchievements: z.boolean().optional(),
      })
      .strict()
      .refine(
        (b) =>
          b.username !== undefined || b.avatarKey !== undefined || b.showAchievements !== undefined,
        { message: 'Nada para alterar.' },
      ),
  },
  async ({ user, body, requestId }) => {
    if (user.username === null)
      throw new HttpError(409, 'NOT_ONBOARDED', 'Crie seu perfil primeiro.');
    if (body.avatarKey !== undefined) await changeAvatar(user, body.avatarKey, requestId);
    if (body.username !== undefined) await changeUsername(user, body.username, requestId);
    if (body.showAchievements !== undefined)
      await setShowAchievements(user, body.showAchievements, requestId);
    return { ok: true };
  },
);
