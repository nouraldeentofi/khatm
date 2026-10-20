// React and ReactDOM load as UMD globals from cdnjs; the bundle only references them.
import type * as ReactNamespace from "react";
import type { Root } from "react-dom/client";

declare global {
  const React: typeof ReactNamespace;
  const ReactDOM: { createRoot(container: Element): Root };
}
