/**
 * Server-renders every generated brand component to static markup (run with tsx, outside
 * Playwright's JSX transform, which produces component-testing placeholders instead of real
 * React elements). Output: test-results/brand-components.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Brand from '../../src/components/brand/generated';

const out: Record<string, string> = {};
for (const [name, Component] of Object.entries(Brand as Record<string, ComponentType>)) {
  out[name] = renderToStaticMarkup(<Component />);
}
const dir = join(import.meta.dirname, '../../test-results');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'brand-components.json'), JSON.stringify(out));
