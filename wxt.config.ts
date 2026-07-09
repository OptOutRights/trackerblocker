import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";

function extensionDevServerCors(): Plugin {
  return {
    name: "trackerblocker-extension-dev-server-cors",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader("Access-Control-Allow-Origin", "*");
        next();
      });
    },
  };
}

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  dev: {
    server: {
      host: "127.0.0.1",
      origin: "http://127.0.0.1:8788",
      port: 8788,
      strictPort: true,
    },
  },
  manifest: {
    name: "TrackerBlocker",
    description: "Blocks and explains likely third-party trackers.",
    version: "0.0.0",
    permissions: ["activeTab", "storage", "webRequest", "webRequestBlocking"],
    host_permissions: ["<all_urls>"],
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
    action: {
      default_title: "TrackerBlocker",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        96: "icon/96.png",
        128: "icon/128.png",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: "trackerblocker@example.local",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  },
  vite: () => ({
    plugins: [preact(), tailwindcss(), extensionDevServerCors()],
  }),
});
