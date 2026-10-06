import type { CSSProperties } from "react";
import {
  resolvedSkinTokens,
  SKIN_EXPORT_PADDING,
  skinSlotRegistry,
  type SkinBinding,
  type SkinDefinition,
} from "../../../shared/skins";
import "./skins.css";

export function skinVariables(skin: SkinDefinition): CSSProperties {
  const t = resolvedSkinTokens(skin.manifest);
  return {
    ...Object.fromEntries(
      Object.entries(t).map(([name, value]) => [
        `--skin-${name}`,
        value.toLowerCase(),
      ]),
    ),
    "--skin-inverse-surface":
      skin.manifest.basePreset === "comic" ? t.text : t.surface,
    "--skin-inverse-text":
      skin.manifest.basePreset === "comic" ? t.canvas : t.text,
    "--skin-strong-border":
      skin.manifest.basePreset === "comic" ? t.text : t.border,
  } as CSSProperties;
}
const stateSelector: Record<string, string> = {
  default: "",
  hover: ":is(:hover,[data-preview-state=hover]):not(:disabled)",
  pressed: ":is(:active,[data-preview-state=pressed]):not(:disabled)",
  focus: ":is(:focus-visible,:focus-within,[data-preview-state=focus])",
  selected:
    ":is(.is-selected,.selected,.active,[aria-pressed=true],[aria-selected=true]):not(:disabled)",
  partial: ":is(.is-partial,[aria-checked=mixed])",
  disabled: ":is(:disabled,[aria-disabled=true],:has(input:disabled))",
  loading: ":is([aria-busy=true],.is-indeterminate)",
  error:
    ":is(.has-error,.aw-tone-error,[aria-invalid=true],:has([aria-invalid=true]))",
  warning: ".aw-tone-warning",
  success: ".aw-tone-success",
  open: ":is([data-presence],[data-preview-state=open])",
  empty: ":not(:has(img))",
  complete: "[aria-valuenow='100']",
  working: ".is-indeterminate",
  removable: ":has(button)",
  long: "",
  paper: ".aw-panel--paper",
};
export function bindingStyle(
  binding: SkinBinding,
  skin: SkinDefinition,
): CSSProperties {
  const resource = skin.manifest.resources.find(
    (r) => r.id === binding.resource,
  );
  const url = skin.urls[binding.resource];
  if (!resource || !url) return {};
  if (binding.fit === "nine-slice") {
    const s = binding.slices!;
    return {
      borderImageSource: `url("${url}")`,
      borderImageSlice: `${s.top * resource.scale} ${s.right * resource.scale} ${s.bottom * resource.scale} ${s.left * resource.scale} fill`,
      borderImageWidth: `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`,
      borderImageOutset: `${binding.bleed}px`,
      borderImageRepeat: "stretch",
    };
  }
  return {
    backgroundImage: `url("${url}")`,
    backgroundRepeat: binding.fit === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: binding.slot === "mark" ? "right top" : "center",
    backgroundSize:
      binding.fit === "tile"
        ? `${resource.width}px ${resource.height}px`
        : binding.fit === "stretch"
          ? "100% 100%"
          : "contain",
  };
}
const cssProperties = (value: CSSProperties) =>
  Object.entries(value)
    .map(
      ([key, v]) =>
        `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v} !important`,
    )
    .join(";");
export function SkinRules({ skin }: { skin: SkinDefinition }) {
  const priorities: Record<string, number> = {
    default: 0,
    hover: 1,
    focus: 2,
    selected: 3,
    partial: 3,
    pressed: 4,
    warning: 5,
    error: 6,
    loading: 7,
    disabled: 8,
  };
  const rules = [...skin.manifest.bindings]
    .sort((a, b) => (priorities[a.state] ?? 3) - (priorities[b.state] ?? 3))
    .map((b) => {
      const definition = skinSlotRegistry.find((d) => d.id === b.component)!;
      // Selectors with :is/:has contain commas; split only at top level.
      const parts: string[] = [];
      let depth = 0,
        begin = 0;
      for (let i = 0; i < definition.selector.length; i++) {
        const c = definition.selector[i];
        if (c === "(" || c === "[") depth++;
        if (c === ")" || c === "]") depth--;
        if (c === "," && !depth) {
          parts.push(definition.selector.slice(begin, i));
          begin = i + 1;
        }
      }
      parts.push(definition.selector.slice(begin));
      const selectors = parts
        .flatMap((p) => {
          const state = stateSelector[b.state] ?? "",
            pseudo =
              b.slot === "decoration" || b.slot === "mark"
                ? "::after"
                : b.component.includes("button") || b.component === "nav-item"
                  ? "::before"
                  : "";
          if (b.slot === "icon")
            return [
              `:scope ${p}${state} > svg:first-of-type:not(.aw-spin)`,
              `:scope:is(${p}${state}) > svg:first-of-type:not(.aw-spin)`,
            ];
          if (["checkbox", "radio"].includes(b.component)) {
            const label =
              b.component === "radio"
                ? ".aw-radio"
                : ".aw-choice:not(.aw-radio)";
            const inputState =
              b.state === "selected"
                ? ":has(input:checked)"
                : b.state === "partial"
                  ? ":has(input:indeterminate)"
                  : b.state === "disabled"
                    ? ":has(input:disabled)"
                    : b.state === "focus"
                      ? ":focus-within"
                      : state;
            return [`:scope ${label}${inputState} .aw-choice-mark${pseudo}`];
          }
          if (b.component === "dialog" && b.state === "open")
            return [
              `:scope[data-presence] ${p}${pseudo}`,
              `:scope ${p}[data-preview-state=open]${pseudo}`,
            ];
          if (b.component === "texture-slot" && b.state === "selected")
            return [
              `:scope ${p}:is([data-bound=true],:has(img),[data-preview-state=selected])${pseudo}`,
            ];
          return [
            `:scope ${p}${state}${pseudo}`,
            `:scope:is(${p}${state})${pseudo}`,
          ];
        })
        .join(",");
      const decorative = b.slot === "decoration" || b.slot === "mark";
      const roots = selectors.replaceAll("::after", "");
      return `${decorative ? `${roots}{position:relative;isolation:isolate;}` : ""}${selectors}{${cssProperties(bindingStyle(b, skin))};${b.slot === "icon" ? "color:transparent!important;stroke:transparent!important;pointer-events:none;" : ""}${decorative ? `content:"";position:absolute;pointer-events:none;${b.slot === "mark" ? "inset:4px 4px auto auto;width:16px;height:16px;" : `inset:-${b.bleed}px;`}z-index:-1;` : ""} background-color:transparent !important;clip-path:none!important;${b.fit === "nine-slice" ? "border-style:solid;" : ""}}`;
    })
    .join("\n");
  return rules ? (
    <style
      data-skin-rules={skin.key}
    >{`@scope ([data-skin-key="${skin.key}"]) to ([data-skin-key]) {${rules}}`}</style>
  ) : null;
}
/** A text-free rendering of the real control's visual classes, shared with client CSS. */
export function SkinSurface({
  skin,
  binding,
  width,
  height,
}: {
  skin: SkinDefinition;
  binding: SkinBinding;
  width: number;
  height: number;
}) {
  const selected = binding.state === "selected",
    partial = binding.state === "partial";
  const classes: Record<string, string> = {
    "primary-button": "aw-button aw-button--primary",
    "secondary-button": "aw-button aw-button--secondary",
    "danger-button": "aw-button aw-button--danger",
    "icon-button": "aw-button aw-button--secondary aw-icon-button",
    "nav-item": "aw-button aw-nav-item",
    tabs: "aw-tabs",
    segmented: "aw-segmented",
    "text-field": "aw-input",
    "search-field": "aw-search",
    "select-field": "aw-select",
    "text-area": "aw-input",
    checkbox: "aw-choice-mark",
    radio: "aw-choice-mark",
    range: "aw-progress-track",
    badge: "aw-badge",
    tag: "aw-tag",
    "status-stamp": "aw-stamp",
    progress: "aw-progress-track",
    hint: "aw-hint",
    "stat-card": "aw-stat",
    "section-title": "aw-section-title",
    panel: "aw-panel aw-panel--dark",
    toolbar: "aw-toolbar",
    "asset-card": "aw-asset-card",
    "group-card": "aw-group-card",
    "texture-slot": "aw-texture-slot",
    menu: "aw-menu aw-layer-surface",
    tooltip: "aw-tooltip aw-layer-surface",
    dialog: "aw-dialog-box",
    toast: "aw-toast",
    "loading-state": "aw-loading",
    "empty-state": "aw-empty",
  };
  const style: CSSProperties = {
    position: "absolute",
    left: SKIN_EXPORT_PADDING,
    top: SKIN_EXPORT_PADDING,
    width: width - SKIN_EXPORT_PADDING * 2,
    height: height - SKIN_EXPORT_PADDING * 2,
    minHeight: 0,
    maxHeight: "none",
    margin: 0,
    pointerEvents: "none",
  };
  const tone = ["error", "warning", "success"].includes(binding.state)
    ? `aw-tone-${binding.state}`
    : "aw-tone-info";
  const common = {
    style,
    "data-preview-state": binding.state,
    className: `${classes[binding.component]} ${selected ? "is-selected" : ""} ${partial ? "is-partial" : ""} ${binding.state === "error" ? "has-error" : ""} ${tone} ${binding.state === "paper" ? "aw-panel--paper" : ""}`,
  };
  let graphic;
  if (binding.component.includes("button") || binding.component === "nav-item")
    graphic = (
      <button
        {...common}
        disabled={binding.state === "disabled"}
        aria-busy={binding.state === "loading"}
        aria-pressed={selected}
      >
        {binding.slot === "icon" && (
          <svg width="16" height="16" aria-hidden="true" />
        )}
      </button>
    );
  else if (binding.component === "text-field")
    graphic = (
      <input
        {...common}
        disabled={binding.state === "disabled"}
        aria-invalid={binding.state === "error"}
        value=""
        readOnly
      />
    );
  else if (binding.component === "text-area")
    graphic = (
      <textarea
        {...common}
        disabled={binding.state === "disabled"}
        aria-invalid={binding.state === "error"}
        value=""
        readOnly
      />
    );
  else if (binding.component === "section-title")
    graphic = (
      <div className="aw-section-title">
        <h2 {...common} style={{ ...style, padding: 0 }}>
          <span />
        </h2>
      </div>
    );
  else if (binding.component === "checkbox" || binding.component === "radio")
    graphic = (
      <label
        className={`aw-choice ${binding.component === "radio" ? "aw-radio" : ""}`}
      >
        <input
          type={binding.component === "radio" ? "radio" : "checkbox"}
          checked={selected}
          disabled={binding.state === "disabled"}
          readOnly
        />
        <span {...common}>
          {partial && (
            <span
              className="aw-minus"
              style={{
                display: "block",
                width: 10,
                height: 2,
                background: "currentColor",
                margin: "7px auto",
              }}
            />
          )}
        </span>
      </label>
    );
  else
    graphic = (
      <div
        {...common}
        aria-disabled={binding.state === "disabled"}
        aria-invalid={binding.state === "error"}
        aria-pressed={selected}
      >
        {["tabs", "segmented"].includes(binding.component) && selected && (
          <span
            className="aw-selection-plate"
            style={{ inset: 0, opacity: 1 }}
          />
        )}
        {["progress", "range"].includes(binding.component) && (
          <span
            className="aw-progress-fill"
            style={{
              display: "block",
              height: "100%",
              background: "var(--aw-accent)",
              width:
                binding.state === "complete"
                  ? "100%"
                  : binding.state === "empty"
                    ? "0%"
                    : "60%",
            }}
          />
        )}
        {["asset-card", "group-card", "texture-slot"].includes(
          binding.component,
        ) &&
          (selected || partial) && (
            <span
              className="aw-card-check"
              style={{ position: "absolute", top: 6, right: 6 }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d={partial ? "M3 8h10" : "m3 8 3 3 7-7"} />
              </svg>
            </span>
          )}
        {["loading-state", "empty-state"].includes(binding.component) && (
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            stroke="var(--aw-accent)"
            strokeWidth="2"
            style={{
              position: "absolute",
              left: "calc(50% - 16px)",
              top: "calc(50% - 16px)",
            }}
          >
            <path
              d={
                binding.component === "loading-state"
                  ? "M28 16A12 12 0 1 1 16 4"
                  : "m4 10 12-6 12 6v14l-12 6-12-6zM4 10l12 6 12-6M16 16v14"
              }
            />
          </svg>
        )}
      </div>
    );
  return (
    <div
      className="aw-skin-export-surface"
      style={{ width, height, ...skinVariables(skin) }}
    >
      {graphic}
    </div>
  );
}
