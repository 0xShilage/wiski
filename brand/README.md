# Brand originals

The Wiski brand files exactly as the designer delivered them: never edited by hand, the source of truth for everything under `public/brand`, `src/components/brand/generated` and `src/app/fonts`.

| Folder | What's in it |
| --- | --- |
| `svg/elements`, `png/elements` | Frames, PONTO (the diamond) and RABINHO (the tail), five brand colours each |
| `svg/mascote`, `png/mascote` | The squirrel mascot, four poses × five colours |
| `svg/patterns`, `png/patterns` | Three background patterns × five colours |
| `png/icons` | The favicon and the blackletter monogram |
| `fonts` | Black Rockie (logo), Escargoth (display), Poppins (text, SIL Open Font License) |
| `links-icon.png` | The picture on the Links page |
| `profile-icons/` | The preset profile pictures' originals (kept locally, not in git) |

The number at the end of each file name is the designer's colour code; [`scripts/brand-map.ts`](../scripts/brand-map.ts) maps it to the palette, and the build fails if a file's colour doesn't match.

Regenerate everything with `npm run brand` (plus `npm run links-photo` and `npm run avatars`), then check it with `npm run test:brand`, which compares every output to these originals pixel by pixel.
