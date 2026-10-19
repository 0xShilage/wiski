'use client';

import { Img } from '@/components/Img';
import {
  AVATAR_BACKGROUND,
  AVATAR_COLOUR_LABEL,
  AVATAR_KEYS,
  type AvatarKey,
  avatarColour,
} from '@/lib/avatars';
import { cn } from '@/lib/cn';

type Props = { value: AvatarKey; onChange: (key: AvatarKey) => void; name?: string };

/** 20 preset avatars as an accessible radio group (arrow keys move between options). */
export function AvatarPicker({ value, onChange, name = 'avatar' }: Props) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold text-lilac">Escolha seu avatar</legend>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
        {AVATAR_KEYS.map((key) => {
          const [, pose] = key.split('-');
          const label = `Mascote ${pose}, ${AVATAR_COLOUR_LABEL[avatarColour(key)]}`;
          const checked = key === value;
          return (
            <label
              key={key}
              className={cn(
                'relative grid aspect-square cursor-pointer place-items-center rounded-full ring-2 transition-shadow has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                AVATAR_BACKGROUND[avatarColour(key)],
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
                aria-label={label}
              />
              <Img
                src={`/brand/${key}.svg`}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="size-[78%] object-contain"
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
