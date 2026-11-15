export const PROTOCOL_VERSION = 2;
export const INDEPENDENT_THRESHOLD_CAPABILITIES = Object.freeze({ independentThresholds: true });
export const LEGACY_WEBSITE_LEVELS = Object.freeze({ level1: 0.2, level2: 0.3, level3: 0.4 });

/** @param {unknown} payload */
export function readBridgeCapabilities(payload) {
  return {
    independentThresholds: Boolean(
      payload
      && typeof payload === "object"
      && /** @type {any} */ (payload).capabilities?.independentThresholds === true,
    ),
  };
}

/** @param {string} type */
export function bridgeAllowsCommand(type) {
  return type === "hello" || type === "clear-plugin-history" || type === "restore-settings";
}

/**
 * @param {any} status
 * @param {{independentThresholds:boolean}} capabilities
 * @param {number} now
 */
export function buildWebsiteSnapshotPayload(status, capabilities, now = Date.now()) {
  const independent = capabilities?.independentThresholds === true;
  return {
    connection: "connected",
    extensionVersion: status.extensionVersion,
    history: status.history,
    settingsBackup: independent ? status.settingsBackup : null,
    depthProfile: independent
      ? status.depthProfile
      : {
        levels: { ...LEGACY_WEBSITE_LEVELS },
        revision: 0,
        updatedAt: now,
        source: "extension",
      },
    capabilities: INDEPENDENT_THRESHOLD_CAPABILITIES,
    health: {
      status: status.health?.status ?? "unknown",
      dormantCount: Number(status.health?.dormantCount) || 0,
    },
  };
}

/** @param {unknown} value */
export function validateEnvelope(value) {
  if (!value || typeof value !== "object") return false;
  const envelope = /** @type {Record<string, unknown>} */ (value);
  return envelope.protocolVersion === PROTOCOL_VERSION
    && typeof envelope.type === "string"
    && envelope.type.length > 0
    && envelope.type.length <= 64
    && Number.isInteger(envelope.revision)
    && Number(envelope.revision) >= 0
    && envelope.payload !== undefined;
}

/** @param {string} type @param {number} revision @param {unknown} payload */
export function envelope(type, revision, payload) {
  return { protocolVersion: PROTOCOL_VERSION, type, revision, payload };
}

/** @param {Array<any>} current @param {Array<any>} incoming @param {number} limit */
export function mergeAlertHistory(current, incoming, limit = 200) {
  const merged = new Map();
  for (const item of [...current, ...incoming]) {
    if (!item || typeof item.id !== "string" || typeof item.time !== "number") continue;
    merged.set(`${item.source ?? "depthwatch"}:${item.id}`, item);
  }
  return [...merged.values()].sort((a, b) => a.time - b.time).slice(-limit);
}
