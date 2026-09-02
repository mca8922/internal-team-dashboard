// HTML sanitization for user-authored rich text (work-log blocks + goal /
// checklist descriptions).
//
// Content is edited in a contentEditable surface and stored as raw innerHTML,
// then rendered back with dangerouslySetInnerHTML. A board member views OTHER
// members' content, so unsanitized markup is a stored-XSS vector that would run
// with the viewer's (possibly elevated) session. We run everything through
// DOMPurify before rendering, allowing only the inline formatting the editors
// can produce (bold / italic / underline / highlight / lists) plus safe links —
// and nothing executable.
import DOMPurify from 'isomorphic-dompurify';

const CONFIG = {
  // Tags our editors emit: inline formatting, lists, links, and the line-break /
  // wrapper elements contentEditable inserts. No images, scripts, iframes, etc.
  ALLOWED_TAGS: [
    'b', 'strong', 'i', 'em', 'u', 's', 'span', 'mark', 'font', 'br', 'div', 'p',
    'ul', 'ol', 'li', 'a',
  ],
  // `style`/`color` carry the highlight + emphasis the toolbar applies; `href`/
  // `target`/`rel` carry links. DOMPurify still strips dangerous CSS and any
  // javascript:/data: URLs.
  ALLOWED_ATTR: ['style', 'color', 'href', 'target', 'rel'],
  // Belt and braces: never keep inline event handlers.
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

// Force every surviving link to open safely in a new tab. Registered once.
let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ((node as Element).tagName === 'A') {
      (node as Element).setAttribute('target', '_blank');
      (node as Element).setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

// Sanitizing is pure — the same stored HTML always yields the same clean HTML —
// but it is not cheap: on the server `isomorphic-dompurify` runs under jsdom.
// The Tasks page renders the same goal/checklist descriptions across many cards
// and re-renders, so without a cache every card pays the full cost every time.
// A process-wide Map keyed by the raw string collapses that to once per value.
// Values here are short descriptions from a small table, so the map stays tiny;
// a soft cap keeps a pathological input set from growing it without bound.
const CACHE = new Map<string, string>();
const CACHE_MAX = 2000;

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  const hit = CACHE.get(dirty);
  if (hit !== undefined) return hit;
  ensureHook();
  const clean = DOMPurify.sanitize(dirty, CONFIG);
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(dirty, clean);
  return clean;
}
