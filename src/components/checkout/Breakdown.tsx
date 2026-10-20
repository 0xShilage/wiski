import { formatBRL } from '@/lib/catalog/pricing';
import type { QuoteLine } from './types';

/** The price breakdown exactly as the server computed it (04 §6): Σ lines = total. */
export function Breakdown({
  lines,
  caption = 'Resumo do valor',
}: {
  lines: QuoteLine[];
  caption?: string;
}) {
  return (
    <table className="wf-breakdown">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={`is-${l.kind}`}>
            <th scope="row">{l.label}</th>
            <td>{l.cents === null ? '' : formatBRL(l.cents).replace('-R$', '− R$')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
