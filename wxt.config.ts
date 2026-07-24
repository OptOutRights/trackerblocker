import path from "node:path";
import { fileURLToPath } from "node:url";

import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";

const packageBaseline =
  process.env.TRACKERBLOCKER_QA_PACKAGE_BASELINE === "true";
const packageBaselineFilterEngine = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "scripts/easyprivacy/package-baseline-filter-engine.ts",
);

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
    name: "Tracker Blocker by Opt Out Rights",
    description: "Blocks and explains likely third-party trackers.",
    developer: {
      name: "Opt Out Rights",
    },
    homepage_url: "https://github.com/OptOutRights/tracker-blocker",
    permissions: [
      "storage",
      "webNavigation",
      "webRequest",
      "webRequestBlocking",
    ],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "Tracker Blocker",
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: "trackerblocker@optoutrights.org",
        strict_min_version: "142.0",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  },
  vite: () => ({
    plugins: [preact(), tailwindcss(), extensionDevServerCors()],
    resolve: packageBaseline
      ? {
          alias: [
            {
              find: "../shared/filterEngine",
              replacement: packageBaselineFilterEngine,
            },
            {
              find: /\/src\/shared\/filterEngine(?:\.ts)?$/,
              replacement: packageBaselineFilterEngine,
            },
          ],
        }
      : undefined,
  }),
});
