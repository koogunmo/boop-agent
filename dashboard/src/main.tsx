import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { App } from "@/App";
import { ErrorBoundary } from "@/ErrorBoundary";
import "./styles.css";

const storedTheme = (() => {
  try {
    return localStorage.getItem("boop-debug-theme");
  } catch {
    return null;
  }
})();
document.documentElement.classList.add(storedTheme === "light" ? "light" : "dark");

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  document.getElementById("root")!.innerHTML = `
    <div style="padding:2rem;font-family:system-ui">
      <h1>VITE_CONVEX_URL is not set</h1>
      <p>Run <code>bun run setup</code> or <code>bun convex dev</code> to configure Convex, then reload.</p>
    </div>`;
} else {
  const convex = new ConvexReactClient(convexUrl);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ConvexAuthProvider client={convex}>
          <App />
        </ConvexAuthProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
