import { useEffect, useRef, useState } from "react";
import { ClientButton } from "./client-ui";
import { Field, Modal } from "./components";
import { call, report } from "./store";
import type { GenerationReference } from "../../shared/generation";

export function GenerationMask({
  reference,
  onSave,
  onClose,
  saveMask,
}: {
  reference: GenerationReference;
  onSave: (ref: GenerationReference) => void;
  onClose: () => void;
  saveMask?: (base64: string) => Promise<GenerationReference>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    mask = useRef<HTMLCanvasElement | null>(null),
    drawing = useRef(false),
    previous = useRef<{ x: number; y: number } | null>(null);
  const image = useRef<HTMLImageElement | null>(null),
    undo = useRef<ImageData[]>([]);
  const [brush, setBrush] = useState(40),
    [erase, setErase] = useState(false),
    [revision, setRevision] = useState(0),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  function redraw() {
    const surface = canvas.current;
    if (!surface || !mask.current || !image.current) return;
    const ctx = surface.getContext("2d")!;
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(image.current, 0, 0);
    const pixels = mask.current
      .getContext("2d")!
      .getImageData(0, 0, surface.width, surface.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = pixels.data[i + 3];
      pixels.data[i] = 239;
      pixels.data[i + 1] = 16;
      pixels.data[i + 2] = 36;
      pixels.data[i + 3] = Math.round((255 - alpha) * 0.55);
    }
    const overlay = document.createElement("canvas");
    overlay.width = surface.width;
    overlay.height = surface.height;
    overlay.getContext("2d")!.putImageData(pixels, 0, 0);
    ctx.drawImage(overlay, 0, 0);
  }
  useEffect(() => {
    const original = new Image();
    original.onload = () => {
      image.current = original;
      const m = document.createElement("canvas");
      m.width = reference.width;
      m.height = reference.height;
      const ctx = m.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, m.width, m.height);
      mask.current = m;
      redraw();
      setReady(true);
    };
    original.onerror = () => report(new Error("无法读取蒙版原图"));
    original.src = reference.previewUrl;
  }, [reference.id]);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - r.left) * reference.width) / r.width,
      y: ((event.clientY - r.top) * reference.height) / r.height,
    };
  }
  function paint(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !mask.current) return;
    const current = point(event),
      ctx = mask.current.getContext("2d")!;
    ctx.globalCompositeOperation = erase ? "source-over" : "destination-out";
    ctx.strokeStyle = "white";
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(
      previous.current?.x ?? current.x,
      previous.current?.y ?? current.y,
    );
    ctx.lineTo(current.x + 0.01, current.y + 0.01);
    ctx.stroke();
    previous.current = current;
    redraw();
  }
  function remember() {
    if (!mask.current) return;
    const ctx = mask.current.getContext("2d")!;
    undo.current.push(
      ctx.getImageData(0, 0, reference.width, reference.height),
    );
    const max = Math.max(
      1,
      Math.min(
        8,
        Math.floor(
          (64 * 1024 * 1024) / (reference.width * reference.height * 4),
        ),
      ),
    );
    while (undo.current.length > max) undo.current.shift();
    setRevision((v) => v + 1);
  }
  return (
    <Modal title="局部修改蒙版" onClose={onClose} wide>
      <p>
        红色区域将被修改，其余区域保留。画笔按原图像素计，保存尺寸为{" "}
        {reference.width} × {reference.height}。
      </p>
      <div className="gen-mask-tools">
        <Field label="画笔大小">
          <input
            type="range"
            min="4"
            max="300"
            value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
          />
        </Field>
        <span>{brush}px</span>
        <ClientButton
          className={erase ? "active" : ""}
          onClick={() => setErase((v) => !v)}
        >
          {erase ? "擦除模式" : "画笔模式"}
        </ClientButton>
        <ClientButton
          disabled={!undo.current.length}
          onClick={() => {
            const data = undo.current.pop();
            if (data) mask.current!.getContext("2d")!.putImageData(data, 0, 0);
            setRevision(revision + 1);
            redraw();
          }}
        >
          撤销
        </ClientButton>
        <ClientButton
          disabled={!ready}
          onClick={() => {
            remember();
            const ctx = mask.current!.getContext("2d")!;
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, reference.width, reference.height);
            redraw();
          }}
        >
          清空
        </ClientButton>
      </div>
      <div className="gen-mask-surface">
        <canvas
          ref={canvas}
          width={reference.width}
          height={reference.height}
          aria-label="在原图上绘制修改区域"
          onPointerDown={(e) => {
            if (!ready) return;
            remember();
            drawing.current = true;
            previous.current = point(e);
            e.currentTarget.setPointerCapture(e.pointerId);
            paint(e);
          }}
          onPointerMove={paint}
          onPointerUp={() => {
            drawing.current = false;
            previous.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = false;
            previous.current = null;
          }}
        />
      </div>
      <div className="modal-actions">
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={!ready || busy}
          onClick={async () => {
            try {
              setBusy(true);
              const ref = saveMask
                ? await saveMask(mask.current!.toDataURL("image/png"))
                : await call<GenerationReference>("generation.mask.save", {
                    referenceId: reference.id,
                    base64: mask.current!.toDataURL("image/png"),
                  });
              onSave(ref);
              onClose();
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存蒙版
        </ClientButton>
      </div>
    </Modal>
  );
}
