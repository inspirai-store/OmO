import { Dialog, EmptyState, LoadingState, Toast } from "./ui-kit";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  dismissOnBackdrop = true,
  closeDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  dismissOnBackdrop?: boolean;
  closeDisabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExitComplete={onClose}
      title={title}
      wide={wide}
      dismissOnBackdrop={dismissOnBackdrop}
      closeDisabled={closeDisabled}
      closeLabel="关闭"
      className="client-theme client-modal"
    >
      <div className="modal-body">{children}</div>
    </Dialog>
  );
}

export function Empty({
  icon,
  heading,
  children,
  action,
}: {
  icon: ReactNode;
  heading: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <EmptyState title={heading} icon={icon} action={action}>
        {children}
      </EmptyState>
    </div>
  );
}

export function Loading({ text = "正在读取本地素材…" }: { text?: string }) {
  return (
    <div className="loading">
      <LoadingState text={text} />
    </div>
  );
}

export function Notice({ text, error }: { text: string; error: boolean }) {
  return (
    <div className="notice">
      <Toast message={text} tone={error ? "error" : "success"} />
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelId = useId();
  function labelControls(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (!isValidElement<any>(node)) return node;
      const element = node as ReactElement<any>;
      if (["input", "select", "textarea"].includes(element.type as string))
        return element.props["aria-label"] || element.props["aria-labelledby"]
          ? element
          : cloneElement(element, { "aria-labelledby": labelId });
      return element.props.children
        ? cloneElement(element, {
            children: labelControls(element.props.children),
          })
        : element;
    });
  }
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {labelControls(children)}
    </label>
  );
}
