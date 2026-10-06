import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentPropsWithRef,
  type RefObject,
} from "react";
import { builtinSkins, type SkinDefinition } from "../../../shared/skins";
import { SkinRules, skinVariables } from "./skin";

export type Accent = "red" | "cyan" | "violet";
export type Density = "regular" | "compact";
export type Tone = "info" | "success" | "warning" | "error";
export type Motion = "system" | "reduced" | "none";
export interface ThemeProps {
  accent?: Accent;
  density?: Density;
  motion?: Motion;
  skin?: SkinDefinition;
}
const defaults = {
  accent: "red",
  density: "regular",
  motion: "system",
  skin: builtinSkins[0],
} as const;
const ThemeContext = createContext<Required<ThemeProps>>(defaults);
export const cx = (...names: (string | false | undefined)[]) =>
  names.filter(Boolean).join(" ");
export const theme = ({ accent, density, motion, skin }: ThemeProps) => ({
  "data-accent": accent,
  "data-density": density,
  "data-motion": motion,
  ...(skin ? { "data-skin": skin.manifest.basePreset, "data-skin-key": skin.key, style: skinVariables(skin) } : {}),
});
export function useResolvedTheme(props: ThemeProps = {}): Required<ThemeProps> {
  const parent = useContext(ThemeContext);
  return {
    accent: props.accent ?? parent.accent,
    density: props.density ?? parent.density,
    motion: props.motion ?? parent.motion,
    skin: props.skin ?? parent.skin,
  };
}
const query = () => window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify: () => void) => {
  const media = query();
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const snapshot = () => query().matches;
export function useMotionMode(override?: Motion) {
  const { motion } = useResolvedTheme({ motion: override });
  const reduced = useSyncExternalStore(subscribe, snapshot, () => false);
  return motion === "none"
    ? "none"
    : motion === "reduced" || reduced
      ? "reduced"
      : "full";
}
export function useMotionPolicy(
  root: RefObject<Element | null>,
  motion?: Motion,
  active = true,
) {
  const mode = useMotionMode(motion);
  useLayoutEffect(() => {
    if (mode === "full") return;
    for (const animation of root.current?.getAnimations({ subtree: true }) ??
      []) {
      const timing = animation.effect?.getTiming();
      const frames =
        animation.effect instanceof KeyframeEffect
          ? animation.effect.getKeyframes()
          : [];
      if (
        mode === "none" ||
        Number(timing?.duration) > 80 ||
        Number(timing?.delay) > 0 ||
        frames.some((frame) =>
          Object.keys(frame).some(
            (key) =>
              ![
                "offset",
                "computedOffset",
                "easing",
                "composite",
                "opacity",
              ].includes(key),
          ),
        )
      )
        animation.cancel();
    }
  }, [mode, active, root]);
}

export function Theme({
  accent,
  density,
  motion,
  skin,
  className,
  children,
  ref,
  ...props
}: ThemeProps & ComponentPropsWithRef<"div">) {
  const resolved = useResolvedTheme({ accent, density, motion, skin });
  const root = useRef<HTMLDivElement>(null);
  useMotionPolicy(root, resolved.motion);
  return (
    <ThemeContext.Provider value={resolved}>
      <div
        {...props}
        {...theme(resolved)}
        style={{ ...theme(resolved).style, ...props.style }}
        className={cx("aw-ui", className)}
        ref={(node) => {
          root.current = node;
          if (typeof ref === "function") return ref(node);
          if (ref) ref.current = node;
        }}
      >
        <SkinRules skin={resolved.skin} />
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
