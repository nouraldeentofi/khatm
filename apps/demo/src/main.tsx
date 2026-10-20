import "./react-global.ts";
import type { Root } from "react-dom/client";
import { App, Boundary } from "./app.tsx";

const w = window as unknown as {
  __khatmRoot?: Root;
  claude?: { hot?: { ready?: (start: () => void) => void } };
};

// The Artifact viewer can re-run this script in place when the page is republished;
// replace the previous React root instead of mounting a second one on the same element.
function start() {
  w.__khatmRoot?.unmount();
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  w.__khatmRoot = root;
  root.render(
    <Boundary onBack={() => location.reload()}>
      <App />
    </Boundary>,
  );
}

if (w.claude?.hot?.ready) w.claude.hot.ready(start);
else start();
