import { describe, expect, it } from "vitest";

import {
  GET_SETTINGS_MESSAGE,
  RESET_SETTINGS_MESSAGE,
  SETTINGS_ERROR_RESPONSE,
  SETTINGS_RESPONSE,
  SET_DOMAIN_OVERRIDE_MESSAGE,
  UPDATE_SITE_PAUSE_MESSAGE,
  isGetSettingsMessage,
  isResetSettingsMessage,
  isSetDomainOverrideMessage,
  isSettingsErrorResponse,
  isSettingsResponse,
  isUpdateSitePauseMessage,
} from "./settings";

describe("settings messaging", () => {
  it("accepts valid settings messages", () => {
    expect(isGetSettingsMessage({ type: GET_SETTINGS_MESSAGE })).toBe(true);
    expect(isResetSettingsMessage({ type: RESET_SETTINGS_MESSAGE })).toBe(true);
    expect(
      isUpdateSitePauseMessage({
        type: UPDATE_SITE_PAUSE_MESSAGE,
        site: "example.com",
        paused: true,
      }),
    ).toBe(true);
    expect(
      isSetDomainOverrideMessage({
        type: SET_DOMAIN_OVERRIDE_MESSAGE,
        domain: "tracker.test",
        action: "block",
      }),
    ).toBe(true);
    expect(
      isSetDomainOverrideMessage({
        type: SET_DOMAIN_OVERRIDE_MESSAGE,
        domain: "tracker.test",
        action: null,
      }),
    ).toBe(true);
  });

  it("rejects invalid settings messages", () => {
    expect(isGetSettingsMessage(null)).toBe(false);
    expect(
      isUpdateSitePauseMessage({
        type: UPDATE_SITE_PAUSE_MESSAGE,
        site: 1,
        paused: true,
      }),
    ).toBe(false);
    expect(
      isSetDomainOverrideMessage({
        type: SET_DOMAIN_OVERRIDE_MESSAGE,
        domain: "tracker.test",
        action: "auto",
      }),
    ).toBe(false);
  });

  it("accepts settings responses", () => {
    expect(
      isSettingsResponse({
        type: SETTINGS_RESPONSE,
        schemaVersion: 1,
        pausedSites: {},
        domainOverrides: {},
      }),
    ).toBe(true);
  });

  it("rejects invalid settings responses", () => {
    expect(
      isSettingsResponse({
        type: SETTINGS_RESPONSE,
        schemaVersion: 2,
        pausedSites: {},
        domainOverrides: {},
      }),
    ).toBe(false);
  });

  it("accepts settings error responses", () => {
    expect(
      isSettingsErrorResponse({
        type: SETTINGS_ERROR_RESPONSE,
        reason: "storage-unavailable",
      }),
    ).toBe(true);
    expect(
      isSettingsErrorResponse({
        type: SETTINGS_ERROR_RESPONSE,
        reason: "network",
      }),
    ).toBe(false);
  });
});
