import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Theme } from "./ui-kit";
import { SkinSurface } from "./ui-kit/skin";
import { SkinPreview } from "./SkinPreview";
import type { SkinBinding, SkinDefinition } from "../../shared/skins";
interface RenderRequest {
  skin: SkinDefinition;
  binding?: SkinBinding;
  width: number;
  height: number;
  scale: number;
  preview?: boolean;
  density?: "regular" | "compact";
}
declare global {
  interface Window {
    skinRenderReady?: boolean;
    renderSkin?: (request: RenderRequest) => Promise<void>;
  }
}
export function SkinRenderHost() {
  const [request, setRequest] = useState<RenderRequest>();
  const complete = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    window.renderSkin = (value) =>
      new Promise((resolve) => {
        complete.current = resolve;
        setRequest(value);
      });
    window.skinRenderReady = true;
    return () => {
      window.skinRenderReady = false;
      delete window.renderSkin;
    };
  }, []);
  useLayoutEffect(() => {
    if (!request) return;
    let active = true;
    void (async () => {
      await Promise.all(
        Object.values(request.skin.urls).map(
          (url) =>
            new Promise<void>((resolve) => {
              const image = new Image();
              image.onload = () => resolve();
              image.onerror = () => resolve();
              image.src = url;
            }),
        ),
      );
      await document.fonts.ready;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (active) complete.current?.();
        }),
      );
    })();
    return () => {
      active = false;
    };
  }, [request]);
  if (!request) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: request.width,
        height: request.height,
        transform: `scale(${request.scale})`,
        transformOrigin: "top left",
      }}
    >
      <Theme
        skin={request.skin}
        motion="none"
        density={request.density}
        style={{
          background: "transparent",
          width: request.width,
          height: request.height,
        }}
      >
        {request.preview ? (
          <SkinPreview skin={request.skin} />
        ) : (
          <SkinSurface
            skin={request.skin}
            binding={request.binding!}
            width={request.width}
            height={request.height}
          />
        )}
      </Theme>
    </div>
  );
}
