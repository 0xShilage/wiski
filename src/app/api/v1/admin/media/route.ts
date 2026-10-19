import { z } from 'zod';
import { pictureFrom } from '@/lib/media';
import { route } from '@/server/http/route';
import { ingestUpload, MAX_UPLOAD_BYTES } from '@/server/media/pipeline';
import { RL } from '@/server/ratelimit/rules';

const query = z.object({ role: z.enum(['POSTER', 'BACKDROP', 'LOGO']) }).strict();

/**
 * POST /api/v1/admin/media?role=POSTER|BACKDROP|LOGO — one image as the raw request body
 * (no multipart parser, no client file name). MODERATOR+ with a verified passkey; the session,
 * role, CSRF and passkey are checked BEFORE a single byte of the body is read (11 §9).
 * nginx: the only location with client_max_body_size 11m (docker/nginx/snippets/upload.conf).
 */
export const POST = route(
  {
    methods: ['POST'],
    access: 'moderator',
    rateLimit: RL.mediaUpload,
    query,
    rawBody: {
      maxBytes: MAX_UPLOAD_BYTES,
      // Not trusted (the bytes decide) — only a coarse filter; SVG/HTML types are refused here.
      contentTypes: [
        'application/octet-stream',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/avif',
      ],
    },
  },
  async ({ req, user, query, audit }) => {
    const { asset, deduplicated, bytes } = await ingestUpload(req.body, query.role, user.id);
    await audit({
      action: 'media.upload',
      targetType: 'MediaAsset',
      targetId: asset.id,
      metadata: { role: asset.role, width: asset.width, height: asset.height, bytes, deduplicated },
    });
    return Response.json(
      {
        id: asset.id,
        role: asset.role,
        width: asset.width,
        height: asset.height,
        picture: pictureFrom(asset),
      },
      { status: deduplicated ? 200 : 201 },
    );
  },
);
