'use client';

// Notion-style block editor — all 10 block types, slash menu, drag reorder,
// selection toolbar, keyboard shortcuts. Ported from block-editor.jsx.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Button } from './ui';
import { sanitizeHtml } from '@/lib/sanitize';
import type { Block, BlockType } from '@/lib/types';

const { useState, useEffect, useLayoutEffect, useRef, useMemo } = React;

interface BlockTypeDef {
  id: BlockType;
  label: string;
  hint: string;
  icon: string;
  group: string;
}

const BLOCK_TYPES: BlockTypeDef[] = [
  { id: 'text', label: 'Text', hint: 'Plain paragraph', icon: 'T', group: 'Basic' },
  { id: 'h1', label: 'Heading 1', hint: 'Big section title', icon: 'H1', group: 'Basic' },
  { id: 'h2', label: 'Heading 2', hint: 'Medium heading', icon: 'H2', group: 'Basic' },
  { id: 'h3', label: 'Heading 3', hint: 'Small heading', icon: 'H3', group: 'Basic' },
  { id: 'bullet', label: 'Bullet List', hint: 'Unordered list', icon: '•', group: 'Lists' },
  { id: 'numbered', label: 'Numbered List', hint: 'Ordered list', icon: '1.', group: 'Lists' },
  { id: 'todo', label: 'To-Do', hint: 'Checklist item', icon: '☐', group: 'Lists' },
  { id: 'table', label: 'Table', hint: 'Rows & columns', icon: '⊞', group: 'Advanced' },
  { id: 'divider', label: 'Divider', hint: 'Horizontal rule', icon: '─', group: 'Advanced' },
  { id: 'quote', label: 'Quote', hint: 'Styled quote', icon: '"', group: 'Advanced' },
  { id: 'code', label: 'Code', hint: 'Monospace block', icon: '<>', group: 'Advanced' },
  { id: 'callout', label: 'Callout', hint: 'Colored info box', icon: '!', group: 'Advanced' },
];

const uid = (p = 'b') => p + '_' + Math.random().toString(36).slice(2, 9);

function emptyBlock(type: BlockType = 'text'): Block {
  const base: Block = { id: uid(), type, content: '' };
  if (type === 'todo') base.done = false;
  if (type === 'callout') {
    base.variant = 'info';
    base.icon = '💡';
  }
  if (type === 'table') {
    base.props = {
      headers: ['Column 1', 'Column 2', 'Column 3'],
      rows: [
        ['', '', ''],
        ['', '', ''],
      ],
    };
  }
  return base;
}

// ---- selection toolbar ----
function useSelectionToolbar(scopeRef: React.RefObject<HTMLDivElement | null>) {
  const [tb, setTb] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    function onSel() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setTb(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!scopeRef.current || !scopeRef.current.contains(range.commonAncestorContainer)) {
        setTb(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setTb(null);
        return;
      }
      const scopeRect = scopeRef.current.getBoundingClientRect();
      // The toolbar (~30px tall) sits 8px above the selection by default. If
      // that would push it above this card's own content — e.g. selecting
      // text on the card's first line — there's nothing to render into up
      // there but the card header or the block above; flip it below the
      // selection instead so it never overlaps neighboring content.
      const TOOLBAR_H = 30;
      const GAP = 8;
      const spaceAbove = rect.top - scopeRect.top;
      const flipBelow = spaceAbove < TOOLBAR_H + GAP;
      setTb({
        top: flipBelow
          ? rect.bottom - scopeRect.top + GAP
          : rect.top - scopeRect.top - TOOLBAR_H - GAP,
        left: rect.left - scopeRect.left + rect.width / 2,
      });
    }
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [scopeRef]);
  return tb;
}

function SelectionToolbar({ pos }: { pos: { top: number; left: number } | null }) {
  if (!pos) return null;
  const cmd = (name: string, val?: string) => {
    // `styleWithCSS` is a document-wide execCommand flag, not scoped to this
    // editor — if it was last left `true` by a highlight elsewhere on the
    // page, bold/italic/underline silently degrade to inline `<span style>`
    // instead of `<b>/<i>/<u>`, which breaks toggle detection. Reset it before
    // every command so formatting here is always semantic, same fix as
    // RichTextEditor's toolbar.
    try {
      document.execCommand('styleWithCSS', false, name === 'hiliteColor' ? 'true' : 'false');
    } catch {
      /* styleWithCSS unsupported — fall back to the browser default */
    }
    document.execCommand(name, false, val);
  };
  return (
    <div
      className="sel-toolbar"
      style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
    >
      <button onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }} title="Bold"><b>B</b></button>
      <button onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }} title="Italic"><i>I</i></button>
      <button onMouseDown={(e) => { e.preventDefault(); cmd('underline'); }} title="Underline"><u>U</u></button>
      <button
        onMouseDown={(e) => { e.preventDefault(); cmd('hiliteColor', '#E1ECE6'); }}
        title="Highlight"
      >
        <span style={{ background: '#E1ECE6', color: '#1F5C3E', padding: '0 4px', borderRadius: 3 }}>H</span>
      </button>
    </div>
  );
}

// ---- slash menu ----
// Anchored to the caret's top/bottom (both, in document coordinates) rather
// than one fixed point, so the menu can flip above the caret when it's opened
// near the bottom of the viewport instead of running off-screen downward.
function SlashMenu({
  query,
  anchor,
  onPick,
  activeIdx,
  setActiveIdx,
}: {
  query: string;
  anchor: { top: number; bottom: number; left: number };
  onPick: (id: BlockType) => void;
  activeIdx: number;
  setActiveIdx: (n: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  // Optimistic first guess (below the caret) so nothing renders at 0,0 before
  // the layout effect below measures the real height and corrects it —
  // useLayoutEffect applies that correction before paint, so there's no flash.
  const [style, setStyle] = useState({ top: anchor.bottom + 6, left: anchor.left });

  const items = useMemo(() => {
    const q = query.toLowerCase();
    return BLOCK_TYPES.filter(
      (b) => !q || b.label.toLowerCase().includes(q) || b.id.includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const m: Record<string, BlockTypeDef[]> = {};
    items.forEach((i) => {
      (m[i.group] = m[i.group] || []).push(i);
    });
    return m;
  }, [items]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const GAP = 6;
    const MARGIN = 8;

    const reposition = () => {
      const menuH = el.offsetHeight;
      const menuW = el.offsetWidth;
      const viewBottom = window.scrollY + window.innerHeight;
      const viewRight = window.scrollX + window.innerWidth;

      // The sticky topbar and (on mobile) the fixed bottom tab bar are their
      // own stacking contexts — a menu portaled to document.body can render
      // BEHIND them despite a higher z-index, since z-index only orders
      // siblings within a shared context. Rather than fight that, treat their
      // on-screen bands as hard no-go zones the menu must never enter.
      const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom;
      const topBound = (topbarBottom ?? 0) + window.scrollY + MARGIN;
      const bottomNavRect = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      const bottomBound =
        bottomNavRect && bottomNavRect.height > 0
          ? bottomNavRect.top + window.scrollY - MARGIN
          : viewBottom - MARGIN;

      // Prefer below the caret; flip above it only if below doesn't fit but
      // above does — so on a short list neither state ever needs to flip.
      const fitsBelow = anchor.bottom + GAP + menuH <= bottomBound;
      const fitsAbove = anchor.top - GAP - menuH >= topBound;
      const top = fitsBelow || !fitsAbove ? anchor.bottom + GAP : anchor.top - GAP - menuH;

      setStyle({
        // Clamp so a menu taller than the available band still starts inside
        // it instead of poking into the topbar/bottom-nav or off an edge.
        top: Math.max(topBound, Math.min(top, bottomBound - menuH)),
        left: Math.max(window.scrollX + MARGIN, Math.min(anchor.left, viewRight - menuW - MARGIN)),
      });
    };

    reposition();
    // Keep tracking the (document-fixed) anchor as the page scrolls or the
    // window resizes — a scroll alone doesn't otherwise re-run this effect.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    // Re-measure whenever the anchor moves or the filtered list changes the
    // menu's height (typing narrows the query → fewer rows → shorter menu).
  }, [anchor, items.length]);

  // Keyboard nav can move the active item below the menu's scroll fold; keep it
  // visible so the highlight isn't stranded off-screen.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!items.length) return null;
  let runningIdx = -1;
  return (
    <div className="slash-menu" ref={ref} style={{ top: style.top, left: style.left }}>
      {Object.entries(grouped).map(([g, list]) => (
        <div key={g}>
          <div className="slash-menu-label">{g}</div>
          {list.map((b) => {
            runningIdx += 1;
            const isActive = runningIdx === activeIdx;
            return (
              <div
                key={b.id}
                ref={isActive ? activeRef : undefined}
                className={`slash-item ${isActive ? 'active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onPick(b.id); }}
                onMouseEnter={() => setActiveIdx(items.indexOf(b))}
              >
                <div className="slash-item-icon">{b.icon}</div>
                <div>
                  <div className="fw-medium">{b.label}</div>
                  <div className="text-xs text-grey">{b.hint}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---- editable text ----
interface EditableTextProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  blockId: string;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  onSlash?: (el: HTMLElement) => void;
  slashActive?: boolean;
}

const EditableText = React.memo(function EditableText({
  value,
  onChange,
  className,
  placeholder,
  autoFocus,
  blockId,
  onEnter,
  onBackspaceEmpty,
  onSlash,
  slashActive,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);
  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={className || 'block-text'}
      data-placeholder={placeholder || ''}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      onKeyDown={(e) => {
        // While the slash menu is open, let it own Enter / arrows / Escape so
        // those keys pick a block type instead of editing text.
        if (slashActive && ['Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) {
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter?.();
        } else if (e.key === 'Backspace') {
          const html = ref.current?.innerHTML;
          if (!html || html === '<br>') {
            e.preventDefault();
            onBackspaceEmpty?.();
          }
        } else if (e.key === '/') {
          // Open the slash menu on the next tick, after the "/" is inserted.
          const el = ref.current;
          if (el) setTimeout(() => onSlash?.(el), 0);
        }
      }}
    />
  );
});

// ---- table block ----
function TableBlock({
  block,
  onUpdate,
}: {
  block: Block;
  onUpdate: (patch: Partial<Block>) => void;
}) {
  const headers = block.props?.headers || [];
  const rows = block.props?.rows || [];
  const update = (patch: Partial<{ headers: string[]; rows: string[][] }>) =>
    onUpdate({ props: { headers, rows, ...patch } });
  const editCell = (rIdx: number, cIdx: number, val: string) =>
    update({
      rows: rows.map((r, i) => (i === rIdx ? r.map((c, j) => (j === cIdx ? val : c)) : r)),
    });
  const editHeader = (cIdx: number, val: string) =>
    update({ headers: headers.map((h, j) => (j === cIdx ? val : h)) });
  const addRow = () => update({ rows: [...rows, Array(headers.length).fill('')] });
  const addCol = () =>
    update({
      headers: [...headers, `Column ${headers.length + 1}`],
      rows: rows.map((r) => [...r, '']),
    });
  const removeRow = () => update({ rows: rows.slice(0, -1) });
  const removeCol = () => {
    if (headers.length <= 1) return;
    update({ headers: headers.slice(0, -1), rows: rows.map((r) => r.slice(0, -1)) });
  };
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="block-table">
          <thead>
            <tr>
              {headers.map((h, j) => (
                <th
                  key={j}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => editHeader(j, e.currentTarget.innerText)}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td
                    key={j}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => editCell(i, j, e.currentTarget.innerText)}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-controls">
        <Button size="sm" variant="secondary" icon="plus" onClick={addRow}>Row</Button>
        <Button size="sm" variant="secondary" icon="plus" onClick={addCol}>Column</Button>
        <Button size="sm" variant="ghost" onClick={removeRow}>− Row</Button>
        <Button size="sm" variant="ghost" onClick={removeCol}>− Column</Button>
      </div>
    </div>
  );
}

// ---- one block row ----
interface BlockViewProps {
  block: Block;
  idx: number;
  onUpdate: (idx: number, patch: Partial<Block>) => void;
  onEnter: (idx: number) => void;
  onDelete: (idx: number) => void;
  onSlash: (idx: number, el: HTMLElement, isPlusBtn?: boolean) => void;
  onDragStart: (idx: number) => void;
  onDragOver: (idx: number) => void;
  onDrop: (idx: number, isEnd?: boolean) => void;
  // Touch-compatible reorder fallback — HTML5 drag-and-drop (above) has no
  // touch equivalent on most mobile browsers, so these swap the block with
  // its neighbor instead. Buttons are CSS-hidden on desktop, where drag
  // already works; canMoveUp/Down just disables at the list's edges.
  onMove: (idx: number, dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  dropTarget: boolean;
  autoFocus: boolean;
  numberedIndex: number;
  slashActive: boolean;
}

function BlockView({
  block,
  idx,
  onUpdate,
  onEnter,
  onDelete,
  onSlash,
  onDragStart,
  onDragOver,
  onDrop,
  onMove,
  canMoveUp,
  canMoveDown,
  dragging,
  dropTarget,
  autoFocus,
  numberedIndex,
  slashActive,
}: BlockViewProps) {
  const handlers = {
    onEnter: () => onEnter(idx),
    onBackspaceEmpty: () => onDelete(idx),
    onSlash: (el: HTMLElement) => onSlash(idx, el, false),
  };

  const editable = (cls: string, placeholder: string) => (
    <EditableText
      blockId={block.id}
      value={block.content}
      onChange={(html) => onUpdate(idx, { content: html })}
      className={cls}
      placeholder={placeholder}
      autoFocus={autoFocus}
      slashActive={slashActive}
      onEnter={handlers.onEnter}
      onBackspaceEmpty={handlers.onBackspaceEmpty}
      onSlash={handlers.onSlash}
    />
  );

  let body: React.ReactNode = null;
  switch (block.type) {
    case 'h1': body = editable('block-text block-h1', 'Heading 1'); break;
    case 'h2': body = editable('block-text block-h2', 'Heading 2'); break;
    case 'h3': body = editable('block-text block-h3', 'Heading 3'); break;
    case 'bullet':
      body = (
        <div className="block-list-item">
          <div className="block-list-marker block-list-marker--bullet" aria-hidden="true" />
          {editable('block-text', 'List item')}
        </div>
      );
      break;
    case 'numbered':
      body = (
        <div className="block-list-item">
          <div className="block-list-marker block-list-marker--numbered">{numberedIndex}.</div>
          {editable('block-text', 'Numbered item')}
        </div>
      );
      break;
    case 'todo':
      body = (
        <div className={`block-todo ${block.done ? 'done' : ''}`}>
          <input
            type="checkbox"
            checked={!!block.done}
            onChange={(e) => onUpdate(idx, { done: e.target.checked })}
          />
          {editable('block-text', 'To-do')}
        </div>
      );
      break;
    case 'divider': body = <div className="block-divider" />; break;
    case 'quote': body = editable('block-text block-quote', 'Quote…'); break;
    case 'code':
      body = (
        <pre className="block-code" style={{ margin: 0 }}>
          <EditableText
            blockId={block.id}
            value={block.content}
            onChange={(html) => onUpdate(idx, { content: html })}
            placeholder="// code"
            autoFocus={autoFocus}
            slashActive={slashActive}
            onEnter={handlers.onEnter}
            onBackspaceEmpty={handlers.onBackspaceEmpty}
            onSlash={handlers.onSlash}
          />
        </pre>
      );
      break;
    case 'callout':
      body = (
        <div className={`block-callout ${block.variant || 'info'}`}>
          <span className="callout-icon">{block.icon || '💡'}</span>
          {editable('block-text', 'Callout text')}
        </div>
      );
      break;
    case 'table':
      body = <TableBlock block={block} onUpdate={(p) => onUpdate(idx, p)} />;
      break;
    default:
      body = editable('block-text', "Type '/' for commands");
  }

  return (
    <div
      className={`block-row ${dragging ? 'dragging' : ''} ${dropTarget ? 'drop-target' : ''}`}
      onDragOver={(e) => { e.preventDefault(); onDragOver(idx); }}
      onDrop={() => onDrop(idx)}
    >
      <div className="block-handle">
        <button
          className="block-handle-btn"
          onClick={(e) => onSlash(idx, e.currentTarget, true)}
          title="Add / change type"
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          className="block-handle-btn drag"
          draggable
          onDragStart={() => onDragStart(idx)}
          onDragEnd={() => onDrop(-1, true)}
          title="Drag to reorder"
        >
          <Icon name="grip" size={14} />
        </button>
        <button
          className="block-handle-btn move-up"
          onClick={() => onMove(idx, -1)}
          disabled={!canMoveUp}
          title="Move up"
        >
          <Icon name="chevron-down" size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button
          className="block-handle-btn move-down"
          onClick={() => onMove(idx, 1)}
          disabled={!canMoveDown}
          title="Move down"
        >
          <Icon name="chevron-down" size={14} />
        </button>
        <button
          className="block-handle-btn delete"
          onClick={() => onDelete(idx)}
          title="Delete this block"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="block-content-wrap">{body}</div>
    </div>
  );
}

// ---- editor root ----
export function BlockEditor({
  initialBlocks,
  onChange,
  resetKey,
  defaultBlockType = 'text',
}: {
  initialBlocks: Block[];
  onChange: (blocks: Block[]) => void;
  resetKey: string;
  // The block type a freshly-added line starts as (Enter, the Add-block
  // button, or an empty editor). Driven by the member's Settings → Editor
  // preference; defaults to a plain text paragraph.
  defaultBlockType?: BlockType;
}) {
  const [blocks, setBlocks] = useState<Block[]>(
    initialBlocks && initialBlocks.length ? initialBlocks : [emptyBlock('text')],
  );
  const [slash, setSlash] = useState<{
    idx: number;
    query: string;
    anchor: { top: number; bottom: number; left: number };
    activeIdx: number;
    forReplace: boolean;
  } | null>(null);
  const [dragSrc, setDragSrc] = useState(-1);
  const [dropIdx, setDropIdx] = useState(-1);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const tb = useSelectionToolbar(scopeRef);

  useEffect(() => {
    setBlocks(initialBlocks && initialBlocks.length ? initialBlocks : [emptyBlock('text')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    onChange(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const update = (idx: number, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b, i) => (i === idx ? { ...b, ...patch } : b)));

  const insertAfter = (idx: number, type: BlockType = defaultBlockType) => {
    const nb = emptyBlock(type);
    setBlocks((bs) => [...bs.slice(0, idx + 1), nb, ...bs.slice(idx + 1)]);
    setFocusBlockId(nb.id);
  };

  const replaceType = (idx: number, type: BlockType) =>
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== idx) return b;
        const nb: Block = { ...b, type };
        if (type === 'divider') nb.content = '';
        if (type === 'table' && !b.props) nb.props = emptyBlock('table').props;
        if (type === 'callout' && !b.variant) {
          nb.variant = 'info';
          nb.icon = '💡';
        }
        return nb;
      }),
    );

  // Block types where Enter should continue the same type (Notion-style list
  // behavior) instead of dropping to the member's default block type.
  const CONTINUABLE_TYPES: BlockType[] = ['bullet', 'numbered', 'todo'];

  const isBlockEmpty = (b: Block) =>
    !(b.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

  const handleEnter = (idx: number) => {
    const current = blocks[idx];
    if (current && CONTINUABLE_TYPES.includes(current.type)) {
      // Enter on an empty list item exits the list (matches Notion) — convert
      // this row to the default type instead of stacking another empty one.
      if (isBlockEmpty(current)) replaceType(idx, defaultBlockType);
      else insertAfter(idx, current.type);
      return;
    }
    insertAfter(idx, defaultBlockType);
  };

  const handleDelete = (idx: number) => {
    if (blocks.length <= 1) {
      setBlocks([emptyBlock('text')]);
      return;
    }
    const prev = blocks[idx - 1];
    setBlocks((bs) => bs.filter((_, i) => i !== idx));
    if (prev) setFocusBlockId(prev.id);
  };

  const handleSlash = (idx: number, anchorEl: HTMLElement, isPlusBtn = false) => {
    // The slash menu is rendered through a portal to document.body so it
    // escapes any card stacking context / overflow trap. Position is therefore
    // in document coordinates (viewport rect + page scroll), not scope-local.
    let rect = anchorEl.getBoundingClientRect();
    if (!isPlusBtn) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.top || r.left || r.width || r.height) rect = r;
      }
    }
    setSlash({
      idx,
      query: '',
      anchor: {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
      },
      activeIdx: 0,
      forReplace: isPlusBtn,
    });
  };

  // Live-filter the slash menu from what the user types after "/". Closes the
  // menu when the trailing "/query" is gone (deleted, or a space was typed).
  useEffect(() => {
    if (!slash || slash.forReplace) return;
    const b = blocks[slash.idx];
    if (!b) {
      setSlash(null);
      return;
    }
    const text = (b.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    const m = text.match(/\/([^/\s]*)$/);
    if (!m) {
      setSlash(null);
      return;
    }
    if (m[1] !== slash.query) {
      setSlash((s) => (s ? { ...s, query: m[1], activeIdx: 0 } : s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, slash]);

  useEffect(() => {
    if (!slash) return;
    const f = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.slash-menu')) setSlash(null);
    };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [slash]);

  const handlePick = (type: BlockType) => {
    if (!slash) return;
    if (slash.forReplace) {
      const b = blocks[slash.idx];
      if (b && (!b.content || b.content === '<br>')) replaceType(slash.idx, type);
      else insertAfter(slash.idx, type);
    } else {
      // Typed "/": drop the trailing "/query" and switch this block's type.
      // A fresh id remounts the row so the DOM picks up the stripped content.
      const stripped = (blocks[slash.idx]?.content || '').replace(/\/[^/\s]*$/, '');
      const newId = uid();
      setBlocks((bs) =>
        bs.map((x, i) => {
          if (i !== slash.idx) return x;
          const nb: Block = { ...x, id: newId, type, content: stripped };
          if (type === 'divider') nb.content = '';
          if (type === 'todo' && nb.done == null) nb.done = false;
          if (type === 'table' && !nb.props) nb.props = emptyBlock('table').props;
          if (type === 'callout' && !nb.variant) {
            nb.variant = 'info';
            nb.icon = '💡';
          }
          return nb;
        }),
      );
      setFocusBlockId(newId);
    }
    setSlash(null);
  };

  useEffect(() => {
    if (!slash) return;
    const items = BLOCK_TYPES.filter(
      (b) => !slash.query || b.label.toLowerCase().includes(slash.query.toLowerCase()),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlash((s) => (s ? { ...s, activeIdx: Math.min(s.activeIdx + 1, items.length - 1) } : s));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlash((s) => (s ? { ...s, activeIdx: Math.max(s.activeIdx - 1, 0) } : s));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = items[slash.activeIdx];
        if (pick) handlePick(pick.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSlash(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slash, blocks]);

  const onDragStart = (idx: number) => setDragSrc(idx);
  const onDragOver = (idx: number) => setDropIdx(idx);
  const onDrop = (_idx: number, isEnd?: boolean) => {
    if (isEnd && dragSrc >= 0 && dropIdx >= 0 && dragSrc !== dropIdx) {
      setBlocks((bs) => {
        const nb = [...bs];
        const [m] = nb.splice(dragSrc, 1);
        nb.splice(dropIdx, 0, m);
        return nb;
      });
    }
    setDragSrc(-1);
    setDropIdx(-1);
  };

  // Touch fallback for reordering — see BlockViewProps.onMove.
  const moveBlock = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    setBlocks((bs) => {
      const nb = [...bs];
      [nb[idx], nb[target]] = [nb[target], nb[idx]];
      return nb;
    });
  };

  return (
    <div className="relative" ref={scopeRef}>
      <SelectionToolbar pos={tb} />
      {blocks.map((b, i) => {
        let ni = 1;
        if (b.type === 'numbered') {
          let k = i;
          while (k > 0 && blocks[k - 1].type === 'numbered') {
            ni += 1;
            k -= 1;
          }
        }
        return (
          <BlockView
            key={b.id}
            block={b}
            idx={i}
            onUpdate={update}
            onEnter={handleEnter}
            onDelete={handleDelete}
            onSlash={handleSlash}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onMove={moveBlock}
            canMoveUp={i > 0}
            canMoveDown={i < blocks.length - 1}
            dragging={dragSrc === i}
            dropTarget={dropIdx === i && dragSrc !== i}
            autoFocus={focusBlockId === b.id}
            numberedIndex={ni}
            slashActive={!!slash && slash.idx === i}
          />
        );
      })}
      {slash && typeof document !== 'undefined'
        ? createPortal(
            <SlashMenu
              query={slash.query}
              anchor={slash.anchor}
              onPick={handlePick}
              activeIdx={slash.activeIdx}
              setActiveIdx={(n) => setSlash((s) => (s ? { ...s, activeIdx: n } : s))}
            />,
            document.body,
          )
        : null}
      <div className="mt-3">
        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          onClick={() => insertAfter(blocks.length - 1)}
        >
          Add block
        </Button>
      </div>
    </div>
  );
}

// ---- read-only renderer ----
export function BlockRender({ blocks }: { blocks: Block[] }) {
  if (!blocks || !blocks.length) return <div className="text-grey">No content.</div>;
  return (
    <div>
      {blocks.map((b, i) => {
        let nIndex = 1;
        if (b.type === 'numbered') {
          let k = i;
          while (k > 0 && blocks[k - 1].type === 'numbered') {
            nIndex += 1;
            k -= 1;
          }
        }
        switch (b.type) {
          case 'h1':
            return <div key={b.id} className="block-text block-h1" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />;
          case 'h2':
            return <div key={b.id} className="block-text block-h2" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />;
          case 'h3':
            return <div key={b.id} className="block-text block-h3" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />;
          case 'bullet':
            return (
              <div key={b.id} className="block-list-item">
                <div className="block-list-marker block-list-marker--bullet" aria-hidden="true" />
                <div className="block-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />
              </div>
            );
          case 'numbered':
            return (
              <div key={b.id} className="block-list-item">
                <div className="block-list-marker block-list-marker--numbered">{nIndex}.</div>
                <div className="block-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />
              </div>
            );
          case 'todo':
            return (
              <div key={b.id} className={`block-todo ${b.done ? 'done' : ''}`}>
                <input type="checkbox" readOnly checked={!!b.done} />
                <div className="block-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />
              </div>
            );
          case 'divider':
            return <div key={b.id} className="block-divider" />;
          case 'quote':
            return <div key={b.id} className="block-text block-quote" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />;
          case 'code':
            return <pre key={b.id} className="block-code">{b.content}</pre>;
          case 'callout':
            return (
              <div key={b.id} className={`block-callout ${b.variant || 'info'}`}>
                <span className="callout-icon">{b.icon || '💡'}</span>
                <div className="block-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />
              </div>
            );
          case 'table': {
            const h = b.props?.headers || [];
            const r = b.props?.rows || [];
            return (
              <table key={b.id} className="block-table" style={{ margin: '8px 0' }}>
                <thead>
                  <tr>
                    {h.map((x, j) => (
                      <th key={j}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((c, ci) => (
                        <td key={ci}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          default:
            return <div key={b.id} className="block-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }} />;
        }
      })}
    </div>
  );
}
