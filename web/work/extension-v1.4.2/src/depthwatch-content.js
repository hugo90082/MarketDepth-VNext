(() => {
  const PAGE_SOURCE = "depthwatch-plugin-page-v1";
  const EXTENSION_SOURCE = "coinglass-indicator-extension-v1";
  let port;
  let reconnectTimer;

  const publish = (message) => {
    window.postMessage({ source: EXTENSION_SOURCE, envelope: message }, location.origin);
  };

  const connect = () => {
    window.clearTimeout(reconnectTimer);
    port = chrome.runtime.connect({ name: "depthwatch-alert-bridge" });
    port.onMessage.addListener(publish);
    port.onDisconnect.addListener(() => {
      port = undefined;
      publish({ protocolVersion: 2, type: "bridge-status", revision: 0, payload: { status: "disconnected" } });
      reconnectTimer = window.setTimeout(connect, 1_000);
    });
    port.postMessage({ protocolVersion: 2, type: "hello", revision: 0, payload: { origin: location.origin } });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== PAGE_SOURCE || !port) return;
    const envelope = event.data.envelope;
    if (!envelope || envelope.protocolVersion !== 2 || typeof envelope.type !== "string") return;
    port.postMessage(envelope);
  });

  connect();
})();
