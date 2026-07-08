import { useEffect, useRef } from "preact/hooks";

const TOAST_TIMEOUT_MS = 7000;

export function RefreshToast({
  message,
  onDismiss,
  onRefresh,
}: {
  message: string | null;
  onDismiss: () => void;
  onRefresh: () => void;
}) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => {
      onDismissRef.current();
    }, TOAST_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      class="fixed inset-x-4 bottom-4 z-50 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-lg"
      role="status"
    >
      <div class="flex items-center justify-between gap-3">
        <span class="leading-snug">{message}</span>
        <div class="flex shrink-0 items-center gap-2">
          <button
            class="rounded-md border border-red-300 bg-white px-2 py-1 font-medium text-red-800 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            aria-label="Dismiss refresh notice"
            class="rounded-md px-1.5 py-1 font-semibold text-red-700 transition hover:bg-red-100"
            type="button"
            onClick={onDismiss}
          >
            x
          </button>
        </div>
      </div>
    </div>
  );
}
