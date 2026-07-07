import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: resolve(__dirname, "public/manifest.json"),
      additionalInputs: ["src/content.ts", "src/background.ts"],
    }),
  ],
  resolve: {
    alias: {
      "@zhieldwrap/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
      },
      // circomlibjs and snarkjs are ZK deps not needed in the extension
      external: ["circomlibjs", "snarkjs"],
    },
  },
});
