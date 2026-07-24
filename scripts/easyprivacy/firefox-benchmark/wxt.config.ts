import { defineConfig } from "wxt";

export default defineConfig({
  publicDir: "../../../public",
  manifestVersion: 3,
  manifest: {
    name: "TrackerBlocker EasyPrivacy Performance Harness",
    version: "0.0.0",
    permissions: [],
    host_permissions: [],
    browser_specific_settings: {
      gecko: {
        id: "trackerblocker-easyprivacy-performance@example.local",
        data_collection_permissions: { required: ["none"] },
      },
    },
  },
});
