import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
/** The same substitution the nginx image's envsubst does: only ${WF_*}, nothing else. */
export function renderSiteTemplate(vars: Record<string, string>): string {
  const src = readFileSync(join(ROOT, 'docker/nginx/templates/wiskiflix.conf.template'), 'utf8');
  return src.replace(/\$\{(WF_[A-Z_]+)\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`nginx template: no value for ${k}`);
    return vars[k]!;
  });
}
