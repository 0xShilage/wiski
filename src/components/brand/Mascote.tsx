import { type AvatarColour } from '@/lib/avatars';
import { cn } from '@/lib/cn';
import * as Brand from './generated';

type Pose = 1 | 2 | 3 | 4;
const NAMES = {
  ink: 'Ink',
  plum: 'Plum',
  violet: 'Violet',
  lavender: 'Lavender',
  lilac: 'Lilac',
} as const;

type Props = { pose: Pose; colour: AvatarColour; className?: string; label?: string };

/** Mascot line art, inlined (server component → zero client JS). Decorative unless `label` is set. */
export function Mascote({ pose, colour, className, label }: Props) {
  const Svg = Brand[`Mascote${pose}${NAMES[colour]}` as keyof typeof Brand];
  return (
    <Svg
      className={cn('h-auto w-full', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
