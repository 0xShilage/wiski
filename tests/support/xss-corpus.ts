/* eslint-disable no-script-url -- these are attack payloads stored as text, never executed */
/**
 * Stored-XSS payload corpus (Phase 3 exit criterion, 05 §8). Used by the sanitiser unit tests,
 * the review API tests (stored byte-for-byte as sanitised plain text) and the browser test
 * (rendered on the page under the real CSP: no dialog, no injected element, no CSP violation).
 *
 * Invisible characters are written as escapes so none hides in this file.
 */
export const XSS_CORPUS: readonly string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "'><img src=x onerror=alert(document.cookie)>",
  'javascript:alert(1)',
  '<a href="javascript:alert(1)">clique</a>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '</textarea><script>alert(1)</script>',
  '</title><script>alert(1)</script>',
  '<style>body{display:none}</style>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<!--<img src="--><img src=x onerror=alert(1)//">',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<details open ontoggle=alert(1)>',
  '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>',
  '<base href="//evil.example/">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button>ok</button></form>',
  '<input autofocus onfocus=alert(1)>',
  '{{constructor.constructor("alert(1)")()}}',
  '${alert(1)}',
  "';alert(1);//",
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
  '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<IMG SRC=JaVaScRiPt:alert(1)>',
  '<img src=x onerror="&#x61;lert(1)">',
  '<x onclick=alert(1)>clique aqui</x>',
  // deception rather than script: bidi reordering, zero-width, controls, fake line separators
  'nota 5\u202E01 = aton',
  'ad\u200Bmin\u200C\u200D diz: avaliação oficial',
  'texto\u0000com\u0007controles\u001B[31m',
  'linha\u2028separada\u2029aqui',
  '\uFEFFcomeça com BOM',
  'tags\u{E0041}\u{E0042}invisíveis',
] as const;

/** Legitimate text that must survive unchanged (accents, emoji, other scripts, maths). */
export const KEEP_CORPUS: readonly string[] = [
  'Ótimo! 🎬🍿 Nota 5/5 — recomendo.',
  'Nota < 5 e > 3, ou seja: 4.',
  'שלום e مرحبا também gostaram',
  'Família 👨\u200D👩\u200D👧 inteira viu', // ZWJ sequence must stay
  'Café, pão de queijo & guaraná',
];
