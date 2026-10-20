'use client';

import { useMemo } from 'react';
import { qrPath } from '@/lib/qr';

/** The Pix QR code, drawn from the copia-e-cola text (dark modules on a white card). */
export function PixQr({ text }: { text: string }) {
  const qr = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      className="wf-qr"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label="QR code do Pix"
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.d} fill="#000000" />
    </svg>
  );
}
