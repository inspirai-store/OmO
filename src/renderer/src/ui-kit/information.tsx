import { type ReactNode, type ComponentPropsWithRef } from "react";
import {
  Box,
  Info,
  CheckCircle2,
  AlertTriangle,
  CircleX,
  X,
  LoaderCircle,
} from "lucide-react";
import { IconButton } from "./operations";
import { type Tone } from "./core";
import { cx, theme, type ThemeProps } from "./core";
export function Badge({
  children,
  className,
  accent,
  density,
  motion,
  skin,
  ...props
}: ComponentPropsWithRef<"span"> & ThemeProps) {
  return (
    <span
      {...props}
      className={cx("aw-badge", className)}
      {...theme({ accent, density, motion, skin })}
    >
      {children}
    </span>
  );
}
export function Tag({
  label,
  onRemove,
  accent,
  density,
  motion,
  skin,
}: ThemeProps & { label: string; onRemove?: () => void }) {
  return (
    <span className="aw-tag" {...theme({ accent, density, motion, skin })}>
      {label}
      {onRemove && (
        <button type="button" aria-label={`移除${label}`} onClick={onRemove}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}
const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: CircleX,
};
export function StatusStamp({
  children,
  tone = "success",
  accent,
  density,
  motion,
  skin,
}: ThemeProps & { children: ReactNode; tone?: Tone }) {
  const Icon = toneIcons[tone];
  return (
    <span
      className={`aw-stamp aw-tone-${tone}`}
      {...theme({ accent, density, motion, skin })}
    >
      <Icon size={15} aria-hidden="true" />
      {children}
    </span>
  );
}
export function ProgressBar({
  value,
  label = "进度",
  accent,
  density,
  motion,
  skin,
}: ThemeProps & { value?: number; label?: string }) {
  const progress =
    value === undefined
      ? undefined
      : Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="aw-progress" {...theme({ accent, density, motion, skin })}>
      <div className="aw-progress-label">
        <span>{label}</span>
        <b>{progress === undefined ? "进行中" : `${Math.round(progress)}%`}</b>
      </div>
      <div
        className="aw-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span
          className={progress === undefined ? "is-indeterminate" : ""}
          style={{ width: `${progress ?? 35}%` }}
        />
      </div>
    </div>
  );
}
export function Hint({
  children,
  tone = "info",
  accent,
  density,
  motion,
  skin,
}: ThemeProps & { children: ReactNode; tone?: Tone }) {
  const Icon = toneIcons[tone];
  return (
    <div
      className={`aw-hint aw-tone-${tone}`}
      {...theme({ accent, density, motion, skin })}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={19} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
export function StatCard({
  label,
  value,
  detail,
  icon,
  accent,
  density,
  motion,
  skin,
}: ThemeProps & {
  label: string;
  value: ReactNode;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="aw-stat" {...theme({ accent, density, motion, skin })}>
      <span className="aw-stat-icon">{icon ?? <Box size={23} />}</span>
      <span className="aw-stat-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Toast({
  message,
  tone = "success",
  onClose,
  accent,
  density,
  motion,
  skin,
}: ThemeProps & { message: string; tone?: Tone; onClose?: () => void }) {
  const Icon = toneIcons[tone];
  return (
    <div
      className={`aw-toast aw-tone-${tone}`}
      role={tone === "error" ? "alert" : "status"}
      {...theme({ accent, density, motion, skin })}
    >
      <Icon size={20} aria-hidden="true" />
      <span>{message}</span>
      {onClose && (
        <IconButton
          label="关闭通知"
          variant="ghost"
          icon={<X size={15} />}
          onClick={onClose}
        />
      )}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
  icon,
  accent,
  density,
  motion,
  skin,
}: ThemeProps & {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="aw-empty" {...theme({ accent, density, motion, skin })}>
      <span className="aw-empty-icon">{icon ?? <Box size={36} />}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function LoadingState({
  text = "正在读取素材…",
  accent,
  density,
  motion,
  skin,
}: ThemeProps & { text?: string }) {
  return (
    <div
      className="aw-loading"
      role="status"
      {...theme({ accent, density, motion, skin })}
    >
      <LoaderCircle className="aw-spin" size={23} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
