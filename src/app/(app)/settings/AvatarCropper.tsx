'use client';

// Avatar crop/zoom dialog. After a member picks an image we open this so they
// can drag to reposition and zoom until their face sits inside the circular
// frame, then we export a clean square the avatar can display. Self-contained:
// the crop maths run on a <canvas>, no external cropper dependency.
import * as React from 'react';
import { Button, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';

const VIEW = 300; // crop viewport (px) shown in the dialog
const OUT = 512; // exported square size (px)

export function AvatarCropper({
  file,
  onCancel,
  onSave,
}: {
  file: File;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [minScale, setMinScale] = React.useState(1);
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [saving, setSaving] = React.useState(false);
  const drag = React.useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Keep the image covering the viewport — never let a gap show at the edges.
  const clamp = React.useCallback(
    (o: { x: number; y: number }, s: number, image: HTMLImageElement | null) => {
      if (!image) return o;
      const w = image.naturalWidth * s;
      const h = image.naturalHeight * s;
      return {
        x: Math.min(0, Math.max(VIEW - w, o.x)),
        y: Math.min(0, Math.max(VIEW - h, o.y)),
      };
    },
    [],
  );

  // Create the object URL and load the picked image together, then start
  // zoomed to "cover" and centred. Creating and revoking the URL in the same
  // effect (rather than a memo + separate cleanup effect) keeps them paired
  // even under Strict Mode's dev-only double-invoke, which otherwise revokes
  // the URL out from under the still-loading Image.
  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    const image = new Image();
    image.onload = () => {
      const ms = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight);
      setImg(image);
      setMinScale(ms);
      setScale(ms);
      setOffset({
        x: (VIEW - image.naturalWidth * ms) / 2,
        y: (VIEW - image.naturalHeight * ms) / 2,
      });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Apply a new zoom while keeping the centre of the circle fixed.
  const applyScale = (s: number) => {
    if (!img) return;
    const next = Math.max(minScale, Math.min(minScale * 4, s));
    const cx = (VIEW / 2 - offset.x) / scale;
    const cy = (VIEW / 2 - offset.y) / scale;
    setScale(next);
    setOffset(clamp({ x: VIEW / 2 - cx * next, y: VIEW / 2 - cy * next }, next, img));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.px);
    const ny = drag.current.oy + (e.clientY - drag.current.py);
    setOffset(clamp({ x: nx, y: ny }, scale, img));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    applyScale(scale * (e.deltaY < 0 ? 1.08 : 0.92));
  };

  const save = () => {
    if (!img) return;
    setSaving(true);
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setSaving(false);
      return;
    }
    // Source square in the original image that maps to the visible viewport.
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const sSize = VIEW / scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    canvas.toBlob(
      (blob) => {
        setSaving(false);
        if (blob) onSave(blob);
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title="Adjust your photo"
      subtitle="Drag to reposition and zoom so you sit nicely inside the circle."
      width={360}
    >
      <div className="avatar-cropper">
        <div
          className="avatar-cropper-stage"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={objectUrl ?? undefined}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                pointerEvents: 'none',
                userSelect: 'none',
                maxWidth: 'none',
              }}
            />
          ) : null}
          <div className="avatar-cropper-mask" />
        </div>

        <div className="avatar-cropper-controls">
          <button
            type="button"
            className="avatar-cropper-zoom"
            aria-label="Zoom out"
            onClick={() => applyScale(scale * 0.88)}
          >
            <Icon name="minus" size={14} />
          </button>
          <input
            type="range"
            min={minScale}
            max={minScale * 4}
            step="any"
            value={scale}
            onChange={(e) => applyScale(Number(e.target.value))}
            aria-label="Zoom"
          />
          <button
            type="button"
            className="avatar-cropper-zoom"
            aria-label="Zoom in"
            onClick={() => applyScale(scale * 1.14)}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>

        <div className="modal-actions">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} icon="check" disabled={!img}>
            Save photo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
