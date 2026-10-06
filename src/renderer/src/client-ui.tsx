import { useRef, type ComponentPropsWithRef } from "react";
import { Button, NavItem, Presence, Toast } from "./ui-kit";
import type { ButtonProps } from "./ui-kit";

/** Bridge existing business controls to the shared kit without changing their handlers. */
export function ClientButton({
  className = "",
  type = "submit",
  ...props
}: ComponentPropsWithRef<"button">) {
  const classes = new Set(className.split(/\s+/));
  // Preview surfaces keep their intrinsic dimensions; only action controls use button plates.
  if (
    ["project-tile", "texture-pick", "slot-name"].some((name) =>
      classes.has(name),
    )
  ) {
    return <button {...props} type={type} className={className} />;
  }
  const variant: ButtonProps["variant"] = classes.has("primary")
    ? "primary"
    : classes.has("danger")
      ? "danger"
      : classes.has("icon-button") || classes.has("text-button")
        ? "ghost"
        : "secondary";
  return (
    <Button
      {...props}
      type={type}
      variant={variant}
      selected={classes.has("active") ? true : undefined}
      className={`client-button ${classes.has("icon-button") ? "aw-icon-button" : ""} ${className}`}
    />
  );
}

export function ClientNav({
  className = "",
  ...props
}: ComponentPropsWithRef<"button">) {
  return (
    <NavItem
      {...props}
      type="button"
      variant="ghost"
      selected={className.split(/\s+/).includes("active")}
      className={`client-nav ${className}`}
    />
  );
}

export function ClientNotice({
  notice,
}: {
  notice: { text: string; error: boolean } | null;
}) {
  const last = useRef(notice);
  if (notice) last.current = notice;
  return (
    <Presence present={!!notice} className="client-notice">
      {last.current && (
        <Toast
          message={last.current.text}
          tone={last.current.error ? "error" : "success"}
        />
      )}
    </Presence>
  );
}
