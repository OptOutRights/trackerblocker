import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "TrackerBlocker Spike Baseline",
    description: "Size baseline for the isolated EasyPrivacy compatibility spike.",
    version: "0.0.0",
    permissions: [],
    host_permissions: [],
    browser_specific_settings: {
      gecko: {
        id: "trackerblocker-easyprivacy-spike-baseline@example.local",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  },
});
