import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { cx, theme, useMotionMode, useResolvedTheme, type ThemeProps } from "./core";

export const MOTION_TOKENS = {
  press: 80,
  hover: 140,
  select: 220,
  reveal: 280,
  dialog: 320,
  exit: 140,
  stagger: 35,
  maxDelay: 175,
} as const;
export type RevealPreset = "title" | "card" | "panel" | "stamp";
export interface RevealProps extends ComponentPropsWithRef<"div">, ThemeProps {
  preset?: RevealPreset;
  delay?: number;
  replayKey?: string | number;
}

/** Keeps the measured root and hit areas still; only opacity and an inert ink layer animate. */
export function Reveal({
  preset = "panel",
  delay = 0,
  replayKey,
  motion,
  skin,
  accent,
  density,
  children,
  className,
  ...props
}: RevealProps) {
  const root = useRef<HTMLDivElement>(null),
    ink = useRef<HTMLSpanElement>(null),
    content = useRef<HTMLDivElement>(null);
  const mode = useMotionMode(motion);
  const resolved = useResolvedTheme({skin});
  const previous = useRef(replayKey);
  useLayoutEffect(() => {
    if (!root.current || !content.current || !ink.current || mode === "none")
      return;
    const animations: Animation[] = [];
    const play = () => {
      animations.forEach((a) => a.cancel());
      const wait =
        mode === "full"
          ? Math.max(0, Math.min(MOTION_TOKENS.maxDelay, delay))
          : 0;
      root.current?.setAttribute("data-revealing", "true");
      const fade = content.current!.animate(
        [{ opacity: 0.25 }, { opacity: 1 }],
        {
          duration: mode === "full" ? MOTION_TOKENS.reveal : 80,
          delay: wait,
          easing: "cubic-bezier(.16,1,.3,1)",
        },
      );
      animations.push(fade);
      if (mode === "full") {
        const frames = resolved.skin.manifest.basePreset !== "comic"
          ? [{opacity:0,transform:resolved.skin.manifest.basePreset === "paper" ? "scale(1.015) rotate(-1deg)" : "translateY(3px)"},{opacity:.08,offset:.4,transform:"none"},{opacity:0,transform:"none"}]
          : preset === "stamp"
            ? [
                { opacity: 0, transform: "scale(1.3) rotate(-9deg)" },
                {
                  opacity: 0.25,
                  transform: "scale(.97) rotate(2deg)",
                  offset: 0.45,
                },
                { opacity: 0, transform: "scale(1) rotate(0)" },
              ]
            : [
                {
                  opacity: 0,
                  transform: "translateX(-12%) skewX(-10deg) scaleX(.8)",
                },
                {
                  opacity: 0.2,
                  transform: "translateX(2%) skewX(-4deg) scaleX(1.03)",
                  offset: 0.35,
                },
                { opacity: 0, transform: "translateX(0) skewX(0) scaleX(1)" },
              ];
        animations.push(
          ink.current!.animate(frames, {
            duration: MOTION_TOKENS.reveal,
            delay: wait,
            easing: "cubic-bezier(.16,1,.3,1)",
          }),
        );
      }
      fade.onfinish = () => root.current?.removeAttribute("data-revealing");
    };
    const replay = previous.current !== replayKey;
    previous.current = replayKey;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          play();
          observer.disconnect();
        }
      },
      { threshold: 0.05 },
    );
    if (replay) play();
    else observer.observe(root.current);
    return () => {
      observer.disconnect();
      animations.forEach((a) => a.cancel());
      root.current?.removeAttribute("data-revealing");
    };
  }, [preset, delay, replayKey, mode, resolved.skin.manifest.basePreset]);
  const { ref, ...rest } = props;
  return (
    <div
      {...rest}
      {...theme({ accent, density, motion, skin })}
      ref={(node) => {
        root.current = node;
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      }}
      className={cx("aw-reveal", `aw-reveal--${preset}`, className)}
    >
      <span ref={ink} className="aw-reveal-ink" aria-hidden="true" />
      <div ref={content} className="aw-reveal-content">
        {children}
      </div>
    </div>
  );
}

export function usePresence(
  present: boolean,
  motion?: ThemeProps["motion"],
  onExitComplete?: () => void,
) {
  const mode = useMotionMode(motion);
  const [retained, setRetained] = useState(present);
  const callback = useRef(onExitComplete);
  callback.current = onExitComplete;
  useLayoutEffect(() => {
    if (present) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    if (mode === "none") {
      setRetained(false);
      callback.current?.();
      return;
    }
    const timer = window.setTimeout(
      () => {
        setRetained(false);
        callback.current?.();
      },
      mode === "reduced" ? 80 : MOTION_TOKENS.exit,
    );
    return () => window.clearTimeout(timer);
  }, [present, retained, mode]);
  return {
    mounted: present || retained,
    phase: present ? "enter" : "exit",
  } as const;
}

export interface PresenceProps
  extends ComponentPropsWithRef<"div">, ThemeProps {
  present: boolean;
  onExitComplete?: () => void;
  children?: ReactNode;
}
export function Presence({
  present,
  onExitComplete,
  motion,
  skin,
  accent,
  density,
  children,
  className,
  ...props
}: PresenceProps) {
  const presence = usePresence(present, motion, onExitComplete);
  if (!presence.mounted) return null;
  return (
    <div
      {...props}
      {...theme({ accent, density, motion, skin })}
      className={cx("aw-presence", className)}
      data-presence={presence.phase}
      inert={!present || undefined}
      aria-hidden={!present || undefined}
    >
      <div className="aw-presence-content">{children}</div>
    </div>
  );
}
