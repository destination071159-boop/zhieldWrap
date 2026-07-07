import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// wagmi@2.19.5 removed `watchConnection`. The @zama-fhe/react-sdk/wagmi adapter still
// imports it, which breaks the Rollup build. This plugin injects a no-op shim so the
// build completes; at runtime the SDK falls back to watchAccount for lifecycle events.
function wagmiCompatPlugin(): Plugin {
  return {
    name: "wagmi-watch-connection-shim",
    transform(code, id) {
      if (id.includes("wagmi") && id.includes("actions.js") && !id.includes("@wagmi/core")) {
        if (!code.includes("watchConnection")) {
          return { code: code + "\nexport const watchConnection = () => () => {};", map: null };
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), wagmiCompatPlugin()],
  resolve: {
    alias: {
      "@zhieldwrap/core": path.resolve(__dirname, "src/core/index.ts"),
    },
  },
  define: {
    // Required for some web3 libraries
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["ethers", "wagmi", "viem"],
    exclude: ["@zama-fhe/react-sdk", "@zama-fhe/sdk"],
  },
  build: {
    rollupOptions: {
      // circomlibjs and snarkjs are large optional deps loaded dynamically at runtime.
      // They are served via CDN or must be installed separately.
      external: ["circomlibjs", "snarkjs"],
    },
  },
});
