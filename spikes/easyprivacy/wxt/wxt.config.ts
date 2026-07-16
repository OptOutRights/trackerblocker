import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "TrackerBlocker EasyPrivacy Spike",
    description: "Build-only compatibility spike for a packaged EasyPrivacy engine.",
    version: "0.0.0",
    permissions: [],
    host_permissions: [],
    browser_specific_settings: {
      gecko: {
        id: "trackerblocker-easyprivacy-spike@example.local",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  },
});
