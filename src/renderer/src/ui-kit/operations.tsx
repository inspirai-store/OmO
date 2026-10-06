import {
  useId,
  useRef,
  useLayoutEffect,
  useState,
  type ReactNode,
  type ComponentPropsWithRef,
  type CSSProperties,
} from "react";
import { ArrowRight, MoreHorizontal, LoaderCircle } from "lucide-react";
import { cx, theme, type ThemeProps } from "./core";
export type ButtonProps = ComponentPropsWithRef<"button"> &
  ThemeProps & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
    loading?: boolean;
    icon?: ReactNode;
    trailingIcon?: ReactNode;
    selected?: boolean;
  };
export function Button({
  variant = "secondary",
  loading,
  disabled,
  icon,
  trailingIcon,
  children,
  className,
  accent,
  density,
  motion,
  skin,
  selected,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      {...theme({ accent, density, motion, skin })}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={selected === undefined ? props["aria-pressed"] : selected}
      className={cx(
        "aw-button",
        `aw-button--${variant}`,
        selected && "is-selected",
        className,
      )}
    >
      {loading ? (
        <LoaderCircle className="aw-spin" size={16} aria-hidden="true" />
      ) : (
        icon
      )}
      {children && <span className="aw-button-label">{children}</span>}
      {trailingIcon}
    </button>
  );
}
export function IconButton({
  label,
  icon,
  ...props
}: Omit<ButtonProps, "children"> & { label: string }) {
  return (
    <Button
      {...props}
      icon={icon ?? <MoreHorizontal size={17} />}
      aria-label={label}
      title={props.title ?? label}
      className={cx("aw-icon-button", props.className)}
    />
  );
}
export function NavItem({
  selected,
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <Button
      {...props}
      selected={undefined}
      aria-current={selected ? "page" : undefined}
      icon={icon}
      trailingIcon={
        selected ? <ArrowRight size={17} aria-hidden="true" /> : undefined
      }
      className={cx("aw-nav-item", selected && "is-selected", className)}
    >
      {children}
    </Button>
  );
}

export interface Choice {
  value: string;
  label: string;
  disabled?: boolean;
  panelId?: string;
}
export interface ChoiceProps extends ThemeProps {
  options: Choice[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}
function useSelectionPlate(value: string) {
  const root = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const update = () => {
      const active = root.current?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"], [aria-pressed="true"]',
      );
      if (!active) {
        setStyle({ opacity: 0 });
        return;
      }
      setStyle({
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
        opacity: 1,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (root.current) {
      observer.observe(root.current);
      root.current
        .querySelectorAll("button")
        .forEach((node) => observer.observe(node));
    }
    return () => observer.disconnect();
  }, [value]);
  return { root, style };
}
export function Tabs({
  options,
  value,
  onChange,
  label,
  accent,
  density,
  motion,
  skin,
}: ChoiceProps) {
  const plate = useSelectionPlate(value);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const enabled = options
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i >= 0);
  const active = options.findIndex((o) => o.value === value);
  return (
    <div
      className="aw-tabs"
      ref={plate.root}
      role="tablist"
      aria-label={label}
      {...theme({ accent, density, motion, skin })}
    >
      <span
        className="aw-selection-plate"
        style={plate.style}
        aria-hidden="true"
      />
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          id={`${uid}-${o.value}`}
          aria-selected={o.value === value}
          aria-controls={o.panelId}
          disabled={o.disabled}
          tabIndex={
            i === (enabled.includes(active) ? active : enabled[0]) ? 0 : -1
          }
          ref={(el) => {
            refs.current[i] = el;
          }}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) ||
              !enabled.length
            )
              return;
            e.preventDefault();
            const at = enabled.indexOf(i);
            const next =
              e.key === "Home"
                ? enabled[0]
                : e.key === "End"
                  ? enabled.at(-1)!
                  : enabled[
                      (at +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        enabled.length) %
                        enabled.length
                    ];
            refs.current[next]?.focus();
            onChange(options[next].value);
          }}
        >
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
export function Segmented({
  options,
  value,
  onChange,
  label,
  accent,
  density,
  motion,
  skin,
}: ChoiceProps) {
  const plate = useSelectionPlate(value);
  return (
    <div
      className="aw-segmented"
      ref={plate.root}
      role="group"
      aria-label={label}
      {...theme({ accent, density, motion, skin })}
    >
      <span
        className="aw-selection-plate"
        style={plate.style}
        aria-hidden="true"
      />
      {options.map((o) => (
        <Button
          key={o.value}
          selected={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
