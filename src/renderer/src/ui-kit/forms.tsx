import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ComponentPropsWithRef,
} from "react";
import { Search, X, Check, ChevronDown } from "lucide-react";
import { IconButton, type Choice } from "./operations";
import { cx, theme, type ThemeProps } from "./core";
interface FieldProps extends ThemeProps {
  label: string;
  error?: string;
  help?: string;
}
function FieldFrame({
  label,
  error,
  help,
  id,
  children,
  accent,
  density,
  motion,
  skin,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div
      className={cx("aw-field", !!error && "has-error")}
      {...theme({ accent, density, motion, skin })}
    >
      <label className="aw-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {(error || help) && (
        <small id={`${id}-hint`} className="aw-field-hint">
          {error || help}
        </small>
      )}
    </div>
  );
}
export type TextFieldProps = FieldProps & ComponentPropsWithRef<"input">;
export function TextField({
  label,
  error,
  help,
  accent,
  density,
  motion,
  skin,
  id,
  className,
  ...props
}: TextFieldProps) {
  const uid = useId(),
    fieldId = id ?? uid;
  return (
    <FieldFrame
      {...{ label, error, help, accent, density, motion, skin, id: fieldId }}
    >
      <input
        {...props}
        id={fieldId}
        className={cx("aw-input", className)}
        aria-invalid={!!error || undefined}
        aria-describedby={
          [props["aria-describedby"], error || help ? `${fieldId}-hint` : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
    </FieldFrame>
  );
}
export function SearchField({
  label,
  error,
  help,
  accent,
  density,
  motion,
  skin,
  id,
  className,
  onClear,
  ...props
}: TextFieldProps & { onClear?: () => void }) {
  const uid = useId(),
    fieldId = id ?? uid;
  return (
    <FieldFrame
      {...{ label, error, help, accent, density, motion, skin, id: fieldId }}
    >
      <div className="aw-search">
        <Search size={17} aria-hidden="true" />
        <input
          {...props}
          type="search"
          id={fieldId}
          className={cx("aw-input", className)}
          aria-invalid={!!error || undefined}
          aria-describedby={
            [props["aria-describedby"], error || help ? `${fieldId}-hint` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {onClear && props.value && (
          <IconButton
            label="清除搜索"
            variant="ghost"
            disabled={props.disabled}
            icon={<X size={14} />}
            onClick={onClear}
          />
        )}
      </div>
    </FieldFrame>
  );
}
export function SelectField({
  label,
  error,
  help,
  accent,
  density,
  motion,
  skin,
  id,
  className,
  options,
  ...props
}: FieldProps &
  Omit<ComponentPropsWithRef<"select">, "children"> & { options: Choice[] }) {
  const uid = useId(),
    fieldId = id ?? uid;
  return (
    <FieldFrame
      {...{ label, error, help, accent, density, motion, skin, id: fieldId }}
    >
      <div className="aw-select">
        <select
          {...props}
          id={fieldId}
          className={cx("aw-input", className)}
          aria-invalid={!!error || undefined}
          aria-describedby={
            [props["aria-describedby"], error || help ? `${fieldId}-hint` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
    </FieldFrame>
  );
}
export function TextArea({
  label,
  error,
  help,
  accent,
  density,
  motion,
  skin,
  id,
  className,
  ...props
}: FieldProps & ComponentPropsWithRef<"textarea">) {
  const uid = useId(),
    fieldId = id ?? uid;
  return (
    <FieldFrame
      {...{ label, error, help, accent, density, motion, skin, id: fieldId }}
    >
      <textarea
        {...props}
        id={fieldId}
        className={cx("aw-input", className)}
        aria-invalid={!!error || undefined}
        aria-describedby={
          [props["aria-describedby"], error || help ? `${fieldId}-hint` : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
    </FieldFrame>
  );
}
export function Checkbox({
  label,
  className,
  accent,
  density,
  motion,
  skin,
  indeterminate,
  ...props
}: ComponentPropsWithRef<"input"> &
  ThemeProps & { label: string; indeterminate?: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const { ref, ...rest } = props;
  return (
    <label
      className={cx("aw-choice", className)}
      {...theme({ accent, density, motion, skin })}
    >
      <input
        {...rest}
        ref={(node) => {
          input.current = node;
          if (typeof ref === "function") return ref(node);
          else if (ref) ref.current = node;
        }}
        type="checkbox"
        aria-checked={indeterminate ? "mixed" : props["aria-checked"]}
      />
      <span className="aw-choice-mark" aria-hidden="true">
        {indeterminate ? (
          <span className="aw-minus" />
        ) : (
          <Check size={14} strokeWidth={4} />
        )}
      </span>
      <span>{label}</span>
    </label>
  );
}
export function Radio({
  label,
  className,
  accent,
  density,
  motion,
  skin,
  ...props
}: ComponentPropsWithRef<"input"> & ThemeProps & { label: string }) {
  return (
    <label
      className={cx("aw-choice", "aw-radio", className)}
      {...theme({ accent, density, motion, skin })}
    >
      <input {...props} type="radio" />
      <span className="aw-choice-mark" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
export function Range({
  label,
  accent,
  density,
  motion,
  skin,
  id,
  className,
  ...props
}: ComponentPropsWithRef<"input"> & ThemeProps & { label: string }) {
  const uid = useId(),
    fieldId = id ?? uid;
  return (
    <div className="aw-range" {...theme({ accent, density, motion, skin })}>
      <label htmlFor={fieldId}>{label}</label>
      <output htmlFor={fieldId}>
        {props.value ?? props.defaultValue ?? 0}
      </output>
      <input {...props} id={fieldId} type="range" className={className} />
    </div>
  );
}
