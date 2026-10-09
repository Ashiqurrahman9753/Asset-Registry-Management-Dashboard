import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The PDF viewer library ships modern syntax (class static blocks etc.) that
  // Vite's default older browser target can't transform. The desktop app runs
  // on a current Chromium, so there's nothing to be compatible with.
  build: { target: "esnext" },
  // Prevents Vite from picking up an unrelated postcss.config.js higher up
  // the filesystem tree (e.g. in the user's home directory).
  css: { postcss: {} },
});
