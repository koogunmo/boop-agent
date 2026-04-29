import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, PROJECT_ROOT, "");
  const port = Number(env.PORT ?? process.env.PORT ?? 8787);

  return {
    root: path.resolve(__dirname),
    envDir: PROJECT_ROOT,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@convex-api": path.resolve(__dirname, "..", "convex", "_generated", "api.js"),
        "@worker": path.resolve(__dirname, "..", "src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          ws: true,
        },
      },
    },
    build: { outDir: path.resolve(PROJECT_ROOT, "dist") },
  };
});
