'use client';

import { Img } from '@/components/Img';
import { AVATAR_COLOR_ORDER, type AvatarKey, avatarLabel, avatarSrc } from '@/lib/avatars';
import { cn } from '@/lib/cn';

type Props = { value: AvatarKey; onChange: (key: AvatarKey) => void; name?: string };

/** The 45 preset profile pictures, ordered by colour, as an accessible radio group (arrow keys move). */
export function AvatarPicker({ value, onChange, name = 'avatar' }: Props) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold text-lilac">Escolha seu avatar</legend>
      <div className="grid grid-cols-5 gap-3 sm:grid-cols-9">
        {AVATAR_COLOR_ORDER.map((key) => {
          const checked = key === value;
          return (
            <label
              key={key}
              className={cn(
                'relative grid aspect-square cursor-pointer place-items-center rounded-full bg-ink ring-2 transition-shadow has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                checked ? 'shadow-glow ring-accent' : 'ring-plum',
              )}
            >
              <input
                type="radio"
                name={name}
                value={key}
                checked={checked}
                onChange={() => onChange(key)}
                className="sr-only"
                aria-label={avatarLabel(key)}
              />
              <Img
                src={avatarSrc(key, 64)}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                unoptimized
                className={cn('size-full rounded-full object-cover', checked ? '' : 'opacity-90')}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
