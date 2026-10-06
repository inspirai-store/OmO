import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ReactNode,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Check, X } from "lucide-react";
import { Button, IconButton } from "./operations";
import { useResolvedTheme, useMotionPolicy } from "./core";
import { usePresence } from "./motion";
import { cx, theme, type ThemeProps } from "./core";
function useLayerPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  layer: RefObject<HTMLElement | null>,
  gap = 8,
) {
  const [position, setPosition] = useState<CSSProperties>({
    left: 0,
    top: 0,
    visibility: "hidden",
  });
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (!anchor.current || !layer.current) return;
      const a = anchor.current.getBoundingClientRect(),
        b = layer.current.getBoundingClientRect(),
        margin = 12;
      const roomBelow = window.innerHeight - a.bottom - gap - margin;
      const below = roomBelow >= b.height || roomBelow >= a.top - gap - margin;
      const maxHeight = Math.max(40, below ? roomBelow : a.top - gap - margin);
      setPosition({
        left: Math.max(
          margin,
          Math.min(a.left, window.innerWidth - b.width - margin),
        ),
        top: below
          ? Math.max(margin, a.bottom + gap)
          : Math.max(margin, a.top - Math.min(b.height, maxHeight) - gap),
        maxHeight,
        visibility: "visible",
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchor.current) observer.observe(anchor.current);
    if (layer.current) observer.observe(layer.current);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, anchor, layer, gap]);
  return position;
}
export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  onSelect?: () => void;
}

export function DropdownMenu({
  label = "更多操作",
  items,
  accent,
  density,
  motion,
  skin,
  defaultOpen = false,
}: ThemeProps & { label?: string; items: MenuItem[]; defaultOpen?: boolean }) {
  const resolved = useResolvedTheme({ accent, density, motion, skin });
  const [open, setOpen] = useState(defaultOpen),
    trigger = useRef<HTMLButtonElement>(null),
    layer = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, resolved.motion);
  useMotionPolicy(layer, resolved.motion, presence.mounted);
  const initial = useRef<"first" | "last">("first"),
    menuId = useId();
  const position = useLayerPosition(presence.mounted, trigger, layer);
  const close = (restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open || position.visibility !== "visible") return;
    const buttons = Array.from(
      layer.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    (initial.current === "last" ? buttons.at(-1) : buttons[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !layer.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, position.visibility]);
  return (
    <>
      <Button
        ref={trigger}
        {...resolved}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        icon={<MoreHorizontal size={17} />}
        onClick={() => {
          initial.current = "first";
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initial.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
      >
        {label}
      </Button>
      {presence.mounted &&
        createPortal(
          <div
            className="aw-ui aw-menu"
            {...theme(resolved)}
            ref={layer}
            id={menuId}
            role="menu"
            aria-label={label}
            aria-hidden={!open || undefined}
            inert={!open || undefined}
            data-presence={presence.phase}
            style={{ ...theme(resolved).style, ...position }}
            onKeyDown={(event) => {
              if (!open) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key === "Tab") {
                close();
                return;
              }
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              if (!buttons.length) return;
              const at = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (at +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            <div className="aw-layer-surface">
              {items.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                  }
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  className={item.danger ? "is-danger" : ""}
                  style={
                    {
                      "--aw-item-delay": Math.min(index * 35, 175) + "ms",
                    } as CSSProperties
                  }
                  onClick={() => {
                    if (!open) return;
                    close();
                    item.onSelect?.();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.checked && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>,
          trigger.current?.closest("dialog") ?? document.body,
        )}
    </>
  );
}
export function Tooltip({
  text,
  children,
  accent,
  density,
  motion,
  skin,
  previewOpen = false,
}: ThemeProps & { text: string; children: ReactNode; previewOpen?: boolean }) {
  const resolved = useResolvedTheme({ accent, density, motion, skin });
  const [open, setOpen] = useState(false),
    anchor = useRef<HTMLSpanElement>(null),
    layer = useRef<HTMLDivElement>(null),
    id = useId();
  const visible = open || previewOpen,
    presence = usePresence(visible, resolved.motion),
    position = useLayerPosition(presence.mounted, anchor, layer);
  useMotionPolicy(layer, resolved.motion, presence.mounted);
  const described = isValidElement<{ "aria-describedby"?: string }>(
    children,
  ) ? (
    cloneElement(children, {
      "aria-describedby":
        [children.props["aria-describedby"], visible ? id : undefined]
          .filter(Boolean)
          .join(" ") || undefined,
    })
  ) : (
    <span aria-describedby={visible ? id : undefined}>{children}</span>
  );
  return (
    <span
      className="aw-tooltip-anchor"
      ref={anchor}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {described}
      {presence.mounted &&
        createPortal(
          <div
            ref={layer}
            id={id}
            role="tooltip"
            aria-hidden={!visible || undefined}
            className="aw-ui aw-tooltip"
            {...theme(resolved)}
            style={{ ...theme(resolved).style, ...position }}
            data-presence={presence.phase}
          >
            <div className="aw-layer-surface">{text}</div>
          </div>,
          anchor.current?.closest("dialog") ?? document.body,
        )}
    </span>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  className,
  closeLabel = "关闭弹窗",
  closeDisabled = false,
  onExitComplete,
  dismissOnBackdrop = true,
  accent,
  density,
  motion,
  skin,
}: ThemeProps & {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
  onExitComplete?: () => void;
  dismissOnBackdrop?: boolean;
}) {
  const resolved = useResolvedTheme({ accent, density, motion, skin });
  const dialog = useRef<HTMLDialogElement>(null),
    previous = useRef<HTMLElement | null>(null),
    requested = useRef(false),
    backdropPress = useRef(false),
    id = useId();
  const presence = usePresence(open, resolved.motion, () => {
    if (dialog.current?.open) {
      dialog.current.close();
      if (previous.current?.isConnected) previous.current.focus();
    }
    onExitComplete?.();
  });
  useMotionPolicy(dialog, resolved.motion, presence.mounted);
  useLayoutEffect(() => {
    if (open) {
      requested.current = false;
      backdropPress.current = false;
      if (!dialog.current?.open) {
        previous.current = document.activeElement as HTMLElement;
        dialog.current?.showModal();
      } else if (!dialog.current.contains(document.activeElement)) {
        dialog.current
          .querySelector<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
          )
          ?.focus();
      }
    }
  }, [open]);
  useEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) {
        element.close();
        if (previous.current?.isConnected) previous.current.focus();
      }
    };
  }, []);
  const requestClose = () => {
    if (!open || closeDisabled || requested.current) return;
    requested.current = true;
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className={cx("aw-ui", "aw-dialog", wide && "aw-dialog--wide", className)}
      {...theme(resolved)}
      data-presence={presence.phase}
      inert={(!open && presence.mounted) || undefined}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const targets = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (node) =>
            node.getClientRects().length > 0 && !node.closest("[inert]"),
        );
        if (!targets.length) {
          event.preventDefault();
          return;
        }
        const first = targets[0],
          last = targets.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        const startedOnBackdrop = backdropPress.current;
        backdropPress.current = false;
        if (
          !dismissOnBackdrop ||
          !startedOnBackdrop ||
          event.target !== event.currentTarget
        )
          return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          requestClose();
      }}
      onPointerDown={(event) => {
        const r = event.currentTarget.getBoundingClientRect();
        backdropPress.current =
          event.target === event.currentTarget &&
          (event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
    >
      <div className="aw-dialog-box">
        <header>
          <h2 id={id}>{title}</h2>
          <IconButton
            label={closeLabel}
            disabled={closeDisabled}
            variant="ghost"
            icon={<X size={19} />}
            onClick={requestClose}
          />
        </header>
        <div className="aw-dialog-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </dialog>
  );
}
