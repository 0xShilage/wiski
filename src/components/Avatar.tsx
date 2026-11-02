import { avatarSrc, resolveAvatarKey } from '@/lib/avatars';
import { cn } from '@/lib/cn';
import { Img } from './Img';

const SIZE_CLASS = {
  32: 'size-8',
  40: 'size-10',
  48: 'size-12',
  64: 'size-16',
  96: 'size-24',
  128: 'size-32',
} as const;

type Props = {
  avatarKey: string | null | undefined;
  /** CSS pixel size; fixed set because sizes are classes (no inline styles under CSP). */
  size?: keyof typeof SIZE_CLASS;
  alt?: string;
  className?: string;
};

/** Preset profile picture: a round WebP (128 px up to 64 CSS px, else 256 px) with a plum ring. */
export function Avatar({ avatarKey, size = 48, alt = '', className }: Props) {
  const key = resolveAvatarKey(avatarKey);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-full bg-ink ring-2 ring-plum',
        SIZE_CLASS[size],
        className,
      )}
    >
      <Img
        src={avatarSrc(key, size)}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        className="size-full object-cover"
      />
    </span>
  );
}
