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

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  ensureHook();
  return DOMPurify.sanitize(dirty, CONFIG);
}
