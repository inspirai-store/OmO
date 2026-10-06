import { type ReactNode, type ComponentPropsWithRef } from "react";
import { Box, Check, Layers, Image, X } from "lucide-react";
import { Badge } from "./information";
import { IconButton } from "./operations";
import { cx, theme, type ThemeProps } from "./core";
export function SectionTitle({
  title,
  eyebrow,
  children,
  as: Heading = "h2",
  accent,
  density,
  motion,
  skin,
}: ThemeProps & {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <header
      className="aw-section-title"
      {...theme({ accent, density, motion, skin })}
    >
      <div>
        {eyebrow && <span className="aw-eyebrow">{eyebrow}</span>}
        <Heading>
          <span>{title}</span>
        </Heading>
      </div>
      {children}
    </header>
  );
}
export function Panel({
  children,
  title,
  footer,
  variant = "dark",
  accent,
  density,
  motion,
  skin,
  className,
  ...props
}: ThemeProps &
  Omit<ComponentPropsWithRef<"section">, "title"> & {
    title?: ReactNode;
    footer?: ReactNode;
    variant?: "dark" | "paper";
  }) {
  return (
    <section
      {...props}
      className={cx("aw-panel", `aw-panel--${variant}`, className)}
      {...theme({ accent, density, motion, skin })}
    >
      {title && <header className="aw-panel-title">{title}</header>}
      <div className="aw-panel-body">{children}</div>
      {footer && <footer className="aw-panel-footer">{footer}</footer>}
    </section>
  );
}
export function Toolbar({
  children,
  label = "操作栏",
  accent,
  density,
  motion,
  skin,
  className,
  ...props
}: ThemeProps & ComponentPropsWithRef<"div"> & { label?: string }) {
  return (
    <div
      {...props}
      className={cx("aw-toolbar", className)}
      role="group"
      aria-label={label}
      {...theme({ accent, density, motion, skin })}
    >
      {children}
    </div>
  );
}
export interface AssetCardProps
  extends Omit<ComponentPropsWithRef<"button">, "title">, ThemeProps {
  title: string;
  subtitle?: string;
  meta?: string;
  image?: string;
  format?: string;
  selected?: boolean;
}
export function AssetCard({
  title,
  subtitle,
  meta,
  image,
  format,
  selected,
  className,
  accent,
  density,
  motion,
  skin,
  ...props
}: AssetCardProps) {
  return (
    <button
      {...props}
      {...theme({ accent, density, motion, skin })}
      type="button"
      title={title}
      className={cx("aw-asset-card", selected && "is-selected", className)}
      aria-pressed={selected}
    >
      <span className="aw-asset-preview">
        {image ? (
          <img src={image} alt="" loading="lazy" />
        ) : (
          <Box size={44} aria-hidden="true" />
        )}
        {format && <Badge>{format}</Badge>}
        {selected && (
          <span className="aw-card-check">
            <Check size={15} strokeWidth={4} />
          </span>
        )}
      </span>
      <span className="aw-asset-caption">
        <strong>{title}</strong>
        <span>
          {subtitle}
          <small>{meta}</small>
        </span>
      </span>
    </button>
  );
}
export function GroupCard({
  count,
  partial,
  title,
  subtitle,
  meta,
  image,
  format,
  selected,
  className,
  accent,
  density,
  motion,
  skin,
  ...props
}: AssetCardProps & { count: number; partial?: boolean }) {
  return (
    <div
      className={cx("aw-group-card", partial && "is-partial")}
      {...theme({ accent, density, motion, skin })}
    >
      <AssetCard
        {...props}
        {...{ title, subtitle, meta, image, format, selected }}
        className={className}
      />
      <span className="aw-group-count">
        <Layers size={12} />
        {count} 个文件{partial ? " · 部分选中" : ""}
      </span>
    </div>
  );
}
export function TextureSlot({
  label,
  detail,
  image,
  onPick,
  onRemove,
  disabled,
  accent,
  density,
  motion,
  skin,
}: ThemeProps & {
  label: string;
  detail?: string;
  image?: string;
  onPick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="aw-texture-slot" {...theme({ accent, density, motion, skin })}>
      <button
        type="button"
        className="aw-texture-pick"
        aria-label={`选择${label}贴图`}
        onClick={onPick}
        disabled={disabled || !onPick}
      >
        {image ? (
          <img key={image} src={image} alt="" />
        ) : (
          <Image size={24} aria-hidden="true" />
        )}
      </button>
      <div>
        <strong>{label}</strong>
        <small title={detail}>{detail || "尚未绑定贴图"}</small>
      </div>
      {onRemove && (
        <IconButton
          label={`移除${label}贴图`}
          variant="ghost"
          icon={<X size={15} />}
          onClick={onRemove}
          disabled={disabled}
        />
      )}
    </div>
  );
}
