import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_RESPONSE,
  isHealthCheckMessage,
  type HealthCheckResponse,
} from "../messaging/health";

export default defineBackground(() => {
  const startedAt = new Date().toISOString();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isHealthCheckMessage(message)) {
      return false;
    }

    const response: HealthCheckResponse = {
      type: HEALTH_CHECK_RESPONSE,
      ok: true,
      startedAt,
    };

    sendResponse(response);
    return false;
  });

  console.info(`[TrackerBlocker] Background ready at ${startedAt}`);
});
