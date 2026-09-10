import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Prevents Vite from picking up an unrelated postcss.config.js higher up
  // the filesystem tree (e.g. in the user's home directory).
  css: { postcss: {} },
});
