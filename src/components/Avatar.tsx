import { AVATAR_BACKGROUND, avatarColour, resolveAvatarKey } from '@/lib/avatars';
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

/** Preset avatar: mascot SVG (static file, unmodified) centred at 78 % on its contrast background. */
export function Avatar({ avatarKey, size = 48, alt = '', className }: Props) {
  const key = resolveAvatarKey(avatarKey);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-plum',
        AVATAR_BACKGROUND[avatarColour(key)],
        SIZE_CLASS[size],
        className,
      )}
    >
      <Img
        src={`/brand/${key}.svg`}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        className="size-[78%] object-contain"
      />
    </span>
  );
}
