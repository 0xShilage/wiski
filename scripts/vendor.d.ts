// Minimal typings for build-script dependencies that ship without declarations.

declare module 'subset-font' {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: {
      targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype';
      preserveNameIds?: number[];
      variationAxes?: Record<string, number>;
    },
  ): Promise<Buffer>;
}

declare module 'opentype.js' {
  export interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  export interface Path {
    getBoundingBox(): BoundingBox;
    toPathData(
      options?: { decimalPlaces?: number; flipY?: boolean; optimize?: boolean } | number,
    ): string;
  }
  export interface Glyph {
    name: string;
    unicode: number;
    advanceWidth: number;
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize: number,
      options?: { kerning?: boolean; features?: Record<string, boolean> },
    ): Path;
    stringToGlyphs(text: string): Glyph[];
    charToGlyphIndex(char: string): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
