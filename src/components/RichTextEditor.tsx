'use client';

// A small inline rich-text editor for short fields (goal + checklist
// descriptions). Gives authors the basics — bold / italic / underline /
// strikethrough / highlight / bullet + numbered lists — via a persistent
// toolbar, and stores the result as HTML. Viewers see it rendered through
// <RichText/>, which sanitizes before injecting (a board member reads other
// members' goals, so unsanitized markup would be a stored-XSS vector).
//
// Storage is HTML, but legacy values are plain text (possibly with newlines):
// RichText keeps `white-space: pre-wrap`, so old line-broken text still reads
// line-by-line while new markup renders normally.
import * as React from 'react';
import { sanitizeHtml } from '@/lib/sanitize';

// Has the stored value any real text once tags/space are stripped? Used to
// treat an "empty" contentEditable (<br>, <div></div>, &nbsp;) as truly empty.
function isBlank(html: string): boolean {
  if (!html) return true;
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length === 0;
}

type Cmd = { name: string; arg?: string; title: string; render: React.ReactNode };

const COMMANDS: Cmd[] = [
  { name: 'bold', title: 'Bold (Ctrl+B)', render: <b>B</b> },
  { name: 'italic', title: 'Italic (Ctrl+I)', render: <i>I</i> },
  { name: 'underline', title: 'Underline (Ctrl+U)', render: <u>U</u> },
  { name: 'strikeThrough', title: 'Strikethrough', render: <s>S</s> },
  {
    // A translucent tint rather than a solid fill: it mixes with whatever
    // surface sits behind it, so the theme's own (already-legible) text
    // color stays readable in both light and dark mode instead of a fixed
    // background/foreground pair going invisible when the theme flips.
    name: 'hiliteColor',
    arg: 'rgba(47, 148, 99, 0.28)',
    title: 'Highlight',
    render: (
      <span
        style={{
          background: 'rgba(47, 148, 99, 0.28)',
          color: 'var(--color-green-primary)',
          padding: '0 4px',
          borderRadius: 3,
        }}
      >
        H
      </span>
    ),
  },
  { name: 'insertUnorderedList', title: 'Bullet list', render: <span>•</span> },
  { name: 'insertOrderedList', title: 'Numbered list', render: <span>1.</span> },
];

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Which formatting commands are active for the current selection — drives the
  // toolbar's pressed state so the user can see that B/I/U actually took.
  const [active, setActive] = React.useState<Record<string, boolean>>({});

  // Seed the DOM from `value` only when it diverges from what the user is
  // typing (initial mount / external reset) — never on every keystroke, which
  // would fight the caret.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Skip while THIS editor is focused — re-seeding mid-type would fight the
    // caret. Otherwise sync from `value`, which covers both the initial mount
    // and the case where the parent supplies the value a tick after mount
    // (e.g. a modal that seeds its state in an effect).
    if (document.activeElement === el) return;
    if (el.innerHTML !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  React.useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  const emit = (html: string) => onChange(isBlank(html) ? '' : html);

  // Is the caret/selection currently inside THIS editor?
  const selectionInEditor = React.useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    return (
      !!el &&
      !!sel &&
      sel.rangeCount > 0 &&
      el.contains(sel.getRangeAt(0).commonAncestorContainer)
    );
  }, []);

  const syncActive = React.useCallback(() => {
    if (!selectionInEditor()) {
      setActive((cur) => (Object.keys(cur).length ? {} : cur));
      return;
    }
    const next: Record<string, boolean> = {};
    for (const c of COMMANDS) {
      try {
        next[c.name] = document.queryCommandState(c.name);
      } catch {
        next[c.name] = false;
      }
    }
    setActive(next);
  }, [selectionInEditor]);

  // Reflect the active formatting as the selection moves.
  React.useEffect(() => {
    document.addEventListener('selectionchange', syncActive);
    return () => document.removeEventListener('selectionchange', syncActive);
  }, [syncActive]);

  const exec = (cmd: Cmd) => {
    const el = ref.current;
    if (!el) return;
    // The toolbar is always visible, so a click can land while the caret is
    // elsewhere (or nowhere) — in which case execCommand silently does nothing.
    // Focus the editor and put the caret at the end first so the command always
    // has a target. THIS is what made "B" appear to do nothing.
    if (!selectionInEditor()) {
      el.focus();
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    // Prefer semantic tags (<b>/<i>/<u>) for everything but the highlight,
    // which needs an inline background colour.
    try {
      document.execCommand('styleWithCSS', false, cmd.name === 'hiliteColor' ? 'true' : 'false');
    } catch {
      /* styleWithCSS unsupported — fall back to the browser default */
    }
    document.execCommand(cmd.name, false, cmd.arg);
    emit(el.innerHTML);
    syncActive();
  };

  return (
    <div className={`rte${className ? ` ${className}` : ''}`}>
      <div className="rte-toolbar" role="toolbar" aria-label="Text formatting">
        {COMMANDS.map((c) => (
          <button
            key={c.name}
            type="button"
            className={`rte-btn${active[c.name] ? ' active' : ''}`}
            aria-pressed={!!active[c.name]}
            title={c.title}
            aria-label={c.title}
            // mousedown + preventDefault keeps the editor's selection alive so
            // the command applies to the highlighted text, not nothing.
            onMouseDown={(e) => {
              e.preventDefault();
              exec(c);
            }}
          >
            {c.render}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        className="rte-input"
        data-placeholder={placeholder || ''}
        onInput={(e) => emit(e.currentTarget.innerHTML)}
        // Paste as plain text — keeps authors from importing messy/unsupported
        // markup (colours, fonts, scripts) that the sanitizer would drop anyway.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}

// Turn bare http(s) URLs in the text into clickable links — so a pasted map /
// doc link "just works" without the author needing a link button. Only text
// OUTSIDE existing tags is touched (and never inside an existing <a>), so it
// can't corrupt markup; the result is still run through sanitizeHtml.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])/g;
function linkify(html: string): string {
  let inAnchor = false;
  return html
    .split(/(<[^>]+>)/)
    .map((seg) => {
      if (seg.startsWith('<')) {
        if (/^<a\b/i.test(seg)) inAnchor = true;
        else if (/^<\/a>/i.test(seg)) inAnchor = false;
        return seg;
      }
      if (inAnchor) return seg;
      return seg.replace(URL_RE, (u) => `<a href="${u}">${u}</a>`);
    })
    .join('');
}

// Read-only render of stored rich text, sanitized. Used everywhere a goal or
// checklist description is shown to a viewer.
export function RichText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  if (isBlank(value)) return null;
  return (
    <span
      className={`rich-text${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkify(value)) }}
    />
  );
}
