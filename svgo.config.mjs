// SVGO — LOSSLESS transforms only (docs/phase-0/06-design-tokens.md §5).
//
// Allowed: move Illustrator's <style> rules into presentation attributes (strict CSP blocks
// <style> inside inline SVG), prefix ids (several SVGs on one page), drop comments/metadata.
// Forbidden: anything touching geometry, numbers or colours (convertPathData,
// cleanupNumericValues, convertColors, mergePaths, convertShapeToPath, …). `preset-default`
// is deliberately NOT used. tests/e2e/brand-pixels.spec.ts proves 0 differing pixels.

/** @param {string} idPrefix unique per asset, e.g. "mascote-1-ink" */
export function svgoConfig(idPrefix) {
  return {
    multipass: false,
    js2svg: { pretty: true, indent: 2, eol: 'lf', finalNewline: true },
    plugins: [
      'removeDoctype',
      'removeXMLProcInst',
      'removeComments',
      'removeMetadata',
      { name: 'inlineStyles', params: { onlyMatchedOnce: false, removeMatchedSelectors: true } },
      { name: 'convertStyleToAttrs', params: { keepImportant: false } },
      'removeEmptyContainers',
      {
        name: 'prefixIds',
        params: { prefix: idPrefix, delim: '-', prefixIds: true, prefixClassNames: true },
      },
    ],
  };
}

export default svgoConfig('wf');
