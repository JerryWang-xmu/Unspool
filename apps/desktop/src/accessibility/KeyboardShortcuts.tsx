import { useEffect } from "react";

export function KeyboardShortcuts({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit?: () => void;
  readonly onCancel?: () => void;
}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]") !== null) return;
      if (event.key === "Escape" && onCancel !== undefined) {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && onSubmit !== undefined) {
        event.preventDefault();
        onSubmit();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onCancel, onSubmit]);
  return null;
}
