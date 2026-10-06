import { Theme, Presence } from "./ui-kit";
import { ClientButton } from "./client-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { MoreHorizontal } from "lucide-react";
import { report, useStore } from "./store";

export interface Command {
  id: string;
  label: string;
  run?: () => unknown | Promise<unknown>;
  children?: Command[];
  disabled?: boolean;
  reason?: string;
  danger?: boolean;
  checked?: boolean;
}
// Each command is an immutable invocation. The ID identifies the operation; its closure captures the opening context.
export const command = (
  id: string,
  label: string,
  run?: Command["run"],
  options: Partial<Command> = {},
): Command => ({ id, label, run, ...options });
export const group = (
  id: string,
  label: string,
  children: Command[],
): Command => ({ id, label, children });
export function executeCommand(item: Command) {
  if (item.disabled || !item.run) return;
  void Promise.resolve().then(item.run).catch(report);
}
interface MenuState {
  request: {
    items: Command[];
    x: number;
    y: number;
    focus: HTMLElement | null;
    token: number;
    scrollPositions: Map<Element, { top: number; left: number }>;
  } | null;
}
const menuStore = create<MenuState>(() => ({ request: null }));
let serial = 0;
export function openMenu(
  items: Command[],
  x: number,
  y: number,
  focus: HTMLElement | null = document.activeElement as HTMLElement,
) {
  const scrollPositions = new Map<Element, { top: number; left: number }>();
  for (let node: Element | null = focus; node; node = node.parentElement)
    scrollPositions.set(node, { top: node.scrollTop, left: node.scrollLeft });
  if (document.scrollingElement)
    scrollPositions.set(document.scrollingElement, {
      top: document.scrollingElement.scrollTop,
      left: document.scrollingElement.scrollLeft,
    });
  menuStore.setState({
    request: { items, x, y, focus, token: ++serial, scrollPositions },
  });
}
export function closeMenu(restore = true) {
  const focus = menuStore.getState().request?.focus;
  menuStore.setState({ request: null });
  if (restore && focus?.isConnected) focus.focus({ preventScroll: true });
}
export async function openAsyncMenu(
  loader: () => Promise<Command[]>,
  x: number,
  y: number,
  focus: HTMLElement | null,
) {
  openMenu(
    [command("loading", "正在读取所选素材…", undefined, { disabled: true })],
    x,
    y,
    focus,
  );
  const token = menuStore.getState().request!.token;
  try {
    const items = await loader();
    const current = menuStore.getState().request;
    if (current?.token === token)
      menuStore.setState({ request: { ...current, items } });
  } catch (e) {
    if (menuStore.getState().request?.token === token) closeMenu();
    report(e);
  }
}
const rightPointers = new WeakMap<
  HTMLElement,
  { x: number; y: number; moved: boolean }
>();
export function menuBindings(items: () => Command[], rightDrag = false) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button === 2)
        rightPointers.set(e.currentTarget, {
          x: e.clientX,
          y: e.clientY,
          moved: false,
        });
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const start = rightPointers.get(e.currentTarget);
      if (
        start &&
        e.buttons & 2 &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6
      )
        start.moved = true;
    },
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,[contenteditable=true]",
        )
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const start = rightPointers.get(e.currentTarget);
      rightPointers.delete(e.currentTarget);
      if (rightDrag && start?.moved) return;
      openMenu(items(), e.clientX, e.clientY, e.currentTarget);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
        if (
          (e.target as HTMLElement).closest(
            "input,textarea,[contenteditable=true]",
          )
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        openMenu(items(), rect.left + 12, rect.top + 12, e.currentTarget);
      }
    },
  };
}
export function MoreButton({
  items,
  label = "更多操作",
}: {
  items: () => Command[];
  label?: string;
}) {
  return (
    <ClientButton
      className="icon-button more-actions"
      aria-label={label}
      {...menuBindings(items)}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(items(), r.left, r.bottom + 4, e.currentTarget);
      }}
    >
      <MoreHorizontal size={18} />
    </ClientButton>
  );
}
export function ContextMenuHost() {
  const request = menuStore((s) => s.request),
    page = useStore((s) => s.page),
    query = useStore((s) => s.query);
  useEffect(() => {
    closeMenu(false);
  }, [page, JSON.stringify(query)]);
  useEffect(() => {
    const close = (e: Event) => {
      if (!(e.target as HTMLElement)?.closest?.(".context-menu"))
        closeMenu(false);
    };
    const scroll = (e: Event) => {
      const request = menuStore.getState().request;
      if (!request || (e.target as HTMLElement)?.closest?.(".context-menu"))
        return;
      const target =
        e.target === document
          ? document.scrollingElement
          : (e.target as Element);
      const before = target ? request.scrollPositions.get(target) : undefined;
      if (
        before &&
        target &&
        before.top === target.scrollTop &&
        before.left === target.scrollLeft
      )
        return;
      closeMenu();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, []);
  const last = useRef(request);
  if (request) last.current = request;
  return last.current
    ? createPortal(
        <Theme className="client-theme client-menu-theme" density="compact">
          <Presence present={!!request}>
            <MenuPanel key={last.current.token} request={last.current} />
          </Presence>
        </Theme>,
        last.current.focus?.closest("dialog") ?? document.body,
      )
    : null;
}
function MenuPanel({
  request,
}: {
  request: NonNullable<MenuState["request"]>;
}) {
  const main = useRef<HTMLDivElement>(null),
    sub = useRef<HTMLDivElement>(null),
    [child, setChild] = useState<number | null>(null),
    [mainPos, setMainPos] = useState({ x: request.x, y: request.y }),
    [subPos, setSubPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const box = main.current!;
    setMainPos({
      x: Math.max(8, Math.min(request.x, innerWidth - box.offsetWidth - 8)),
      y: Math.max(8, Math.min(request.y, innerHeight - box.offsetHeight - 8)),
    });
    box
      .querySelector<HTMLElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [request.items]);
  useLayoutEffect(() => {
    if (!main.current?.contains(document.activeElement))
      main.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [request.items]);
  useLayoutEffect(() => {
    if (child === null || !sub.current) return;
    const row = main
        .current!.querySelectorAll("button")
        [child].getBoundingClientRect(),
      width = sub.current.offsetWidth;
    setSubPos({
      x:
        row.right + width + 8 < innerWidth
          ? row.right + 3
          : Math.max(8, row.left - width - 3),
      y: Math.max(
        8,
        Math.min(row.top, innerHeight - sub.current.offsetHeight - 8),
      ),
    });
  }, [child, mainPos]);
  function keys(e: React.KeyboardEvent, level: "main" | "sub") {
    const panel = level === "main" ? main.current : sub.current;
    if (!panel) return;
    const buttons = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      ),
      index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === "ArrowLeft" && level === "sub") {
      e.preventDefault();
      const old = child;
      setChild(null);
      if (old !== null)
        main.current
          ?.querySelectorAll("button")
          [old]?.focus({ preventScroll: true });
    } else if (e.key === "ArrowRight" && level === "main") {
      e.preventDefault();
      const fullIndex = Array.from(
        main.current!.querySelectorAll("button"),
      ).indexOf(document.activeElement as HTMLButtonElement);
      if (request.items[fullIndex]?.children) {
        setChild(fullIndex);
        requestAnimationFrame(() =>
          sub.current
            ?.querySelector<HTMLElement>("button:not(:disabled)")
            ?.focus({ preventScroll: true }),
        );
      }
    } else if (e.key === "Tab") {
      closeMenu();
    }
  }
  function rows(items: Command[], level: "main" | "sub") {
    return items.map((item, i) => (
      <button
        key={item.id}
        aria-label={item.label}
        role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
        aria-checked={item.checked}
        aria-haspopup={item.children ? "menu" : undefined}
        aria-expanded={item.children ? child === i : undefined}
        disabled={item.disabled}
        title={item.reason}
        className={item.danger ? "danger" : ""}
        onMouseEnter={() => {
          if (level === "main") setChild(item.children ? i : null);
        }}
        onClick={() => {
          if (item.children) {
            setChild(i);
            requestAnimationFrame(() =>
              sub.current
                ?.querySelector<HTMLElement>("button:not(:disabled)")
                ?.focus({ preventScroll: true }),
            );
          } else {
            closeMenu();
            executeCommand(item);
          }
        }}
      >
        <span>
          {item.checked ? "✓ " : ""}
          {item.label}
          {item.reason && <small>{item.reason}</small>}
        </span>
        {item.children && <span>›</span>}
      </button>
    ));
  }
  return (
    <>
      <div
        ref={main}
        className="context-menu"
        role="menu"
        aria-label="操作菜单"
        style={{ left: mainPos.x, top: mainPos.y }}
        onKeyDown={(e) => keys(e, "main")}
        onContextMenu={(e) => e.preventDefault()}
      >
        {rows(request.items, "main")}
      </div>
      {child !== null && request.items[child]?.children && (
        <div
          ref={sub}
          className="context-menu submenu"
          role="menu"
          aria-label={request.items[child].label}
          style={{ left: subPos.x, top: subPos.y }}
          onKeyDown={(e) => keys(e, "sub")}
          onContextMenu={(e) => e.preventDefault()}
        >
          {rows(request.items[child].children!, "sub")}
        </div>
      )}
    </>
  );
}
