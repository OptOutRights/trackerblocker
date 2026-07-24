import type { DomainOverrideAction } from "../shared/requestDecisions";
import type { SitePauseMode, TrackerBlockerSettings } from "../storage/settings";

export const GET_SETTINGS_MESSAGE = "trackerblocker.getSettings";
export const UPDATE_SITE_PAUSE_MESSAGE = "trackerblocker.updateSitePause";
export const SET_DOMAIN_OVERRIDE_MESSAGE = "trackerblocker.setDomainOverride";
export const SET_SITE_ALLOW_MESSAGE = "trackerblocker.setSiteAllow";
export const RESET_SETTINGS_MESSAGE = "trackerblocker.resetSettings";
export const SETTINGS_RESPONSE = "trackerblocker.settingsResponse";
export const SETTINGS_ERROR_RESPONSE = "trackerblocker.settingsErrorResponse";

export interface GetSettingsMessage {
  type: typeof GET_SETTINGS_MESSAGE;
}

export interface UpdateSitePauseMessage {
  type: typeof UPDATE_SITE_PAUSE_MESSAGE;
  site: string;
  mode: SitePauseMode;
  tabId?: number;
}

export interface SetDomainOverrideMessage {
  type: typeof SET_DOMAIN_OVERRIDE_MESSAGE;
  domain: string;
  action: DomainOverrideAction | null;
}

export interface SetSiteAllowMessage {
  type: typeof SET_SITE_ALLOW_MESSAGE;
  site: string;
  domain: string;
  allowed: boolean;
  tabId?: number;
  generation?: number;
  rowId?: string;
}

export interface ResetSettingsMessage {
  type: typeof RESET_SETTINGS_MESSAGE;
}

export type SettingsMessage =
  | GetSettingsMessage
  | UpdateSitePauseMessage
  | SetDomainOverrideMessage
  | SetSiteAllowMessage
  | ResetSettingsMessage;

export interface SettingsResponse extends TrackerBlockerSettings {
  type: typeof SETTINGS_RESPONSE;
}

export function isSetSiteAllowMessage(
  value: unknown,
): value is SetSiteAllowMessage {
  const record = value as Record<string, unknown>;

  return (
    hasType(value, SET_SITE_ALLOW_MESSAGE) &&
    typeof record.site === "string" &&
    typeof record.domain === "string" &&
    typeof record.allowed === "boolean" &&
    (!hasSiteAllowContext(record) ||
      (Number.isSafeInteger(record.tabId) &&
        Number.isSafeInteger(record.generation) &&
        typeof record.rowId === "string"))
  );
}

export interface SettingsErrorResponse {
  type: typeof SETTINGS_ERROR_RESPONSE;
  reason: "storage-unavailable" | "stale-page";
}

export function isGetSettingsMessage(
  value: unknown,
): value is GetSettingsMessage {
  return hasType(value, GET_SETTINGS_MESSAGE);
}

export function isUpdateSitePauseMessage(
  value: unknown,
): value is UpdateSitePauseMessage {
  return (
    hasType(value, UPDATE_SITE_PAUSE_MESSAGE) &&
    "site" in value &&
    typeof value.site === "string" &&
    "mode" in value &&
    (value.mode === "once" || value.mode === "always" || value.mode === null) &&
    (!("tabId" in value) || typeof value.tabId === "number")
  );
}

export function isSetDomainOverrideMessage(
  value: unknown,
): value is SetDomainOverrideMessage {
  return (
    hasType(value, SET_DOMAIN_OVERRIDE_MESSAGE) &&
    "domain" in value &&
    typeof value.domain === "string" &&
    "action" in value &&
    (value.action === "block" ||
      value.action === "allow" ||
      value.action === null)
  );
}

export function isResetSettingsMessage(
  value: unknown,
): value is ResetSettingsMessage {
  return hasType(value, RESET_SETTINGS_MESSAGE);
}

export function isSettingsResponse(value: unknown): value is SettingsResponse {
  return (
    hasType(value, SETTINGS_RESPONSE) &&
    "schemaVersion" in value &&
    value.schemaVersion === 2 &&
    "pausedSites" in value &&
    typeof value.pausedSites === "object" &&
    value.pausedSites !== null &&
    "domainOverrides" in value &&
    typeof value.domainOverrides === "object" &&
    value.domainOverrides !== null &&
    "siteAllows" in value &&
    typeof value.siteAllows === "object" &&
    value.siteAllows !== null
  );
}

export function isSettingsErrorResponse(
  value: unknown,
): value is SettingsErrorResponse {
  return (
    hasType(value, SETTINGS_ERROR_RESPONSE) &&
    "reason" in value &&
    (value.reason === "storage-unavailable" || value.reason === "stale-page")
  );
}

function hasType<TType extends string>(
  value: unknown,
  type: TType,
): value is { type: TType } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === type
  );
}

function hasSiteAllowContext(value: Record<string, unknown>): boolean {
  return "tabId" in value || "generation" in value || "rowId" in value;
}
