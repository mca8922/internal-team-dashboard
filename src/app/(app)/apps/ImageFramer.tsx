'use client';

// The framing popup. After the Board picks an image file, this lets them pan
// and zoom to frame it inside a 1:1 tile. The framed result is rendered to a
// 512px square canvas and handed back as a data URL (WebP with a PNG fallback);
// the rounded corners and glass treatment are applied by the tile itself.
import * as React from 'react';
import { Button, Modal } from '@/components/ui';

const STAGE = 300; // on-screen framing square, in px
const OUT = 512; // exported image edge, in px
const RATIO = OUT / STAGE;

export function ImageFramer({
  open,
  src,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  src: string | null;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = React.useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Reset every time a new image is opened for framing.
  React.useEffect(() => {
    if (!open || !src) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNat(null);
    const im = new Image();
    im.onload = () => {
      imgRef.current = im;
      setNat({ w: im.naturalWidth, h: im.naturalHeight });
    };
    im.src = src;
  }, [open, src]);

  // Cover scale: at zoom 1 the image already fills the square (no gaps), so the
  // tile is always edge to edge.
  const coverScale = nat ? Math.max(STAGE / nat.w, STAGE / nat.h) : 1;
  const dispW = nat ? nat.w * coverScale * zoom : 0;
  const dispH = nat ? nat.h * coverScale * zoom : 0;

  // Keep the image covering the square so panning never reveals a gap.
  const clamp = React.useCallback(
    (o: { x: number; y: number }, w: number, h: number) => {
      const mx = Math.max(0, (w - STAGE) / 2);
      const my = Math.max(0, (h - STAGE) / 2);
      return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
    },
    [],
  );

  // Re-clamp when zoom changes (a smaller zoom can push the image out of bounds).
  React.useEffect(() => {
    if (!nat) return;
    setOffset((o) => clamp(o, nat.w * coverScale * zoom, nat.h * coverScale * zoom));
  }, [zoom, nat, coverScale, clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = {
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    };
    setOffset(clamp(next, dispW, dispH));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => Math.min(3, Math.max(1, z - e.deltaY * 0.0015)));
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dw = dispW * RATIO;
    const dh = dispH * RATIO;
    const dx = OUT / 2 + offset.x * RATIO - dw / 2;
    const dy = OUT / 2 + offset.y * RATIO - dh / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    let out = canvas.toDataURL('image/webp', 0.92);
    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');
    onConfirm(out);
  };

  return (
    <Modal open={open} onClose={onCancel} title="Frame the image" width={380}>
      <p className="text-xs text-grey mb-4">
        Drag to position and scroll or use the slider to zoom. The image fills the
        tile, so frame the part you want on show.
      </p>

      <div className="framer-stage-wrap">
        <div
          className="framer-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {nat && src ? (
            <img
              src={src}
              alt=""
              style={{
                width: dispW,
                height: dispH,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          ) : null}
          <div className="framer-ring" />
        </div>

        <div className="framer-zoom">
          <span className="text-xs text-grey">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="modal-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={!nat}>
          Use image
        </Button>
      </div>
    </Modal>
  );
}
