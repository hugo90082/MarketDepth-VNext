const COINGLASS_TV = "https://www.coinglass.com/tv/zh-TW/*";
const DEPTHWATCH_TEST = "https://aggregate-spot-depth-test.magic-knoll-8651.chatgpt.site/*";
const DEPTHWATCH_PRODUCTION = "https://order-book-depth-ratio-monitor.magic-knoll-8651.chatgpt.site/*";

const MARKETDEPTH = "https://marketdepth-observatory.magic-knoll-8651.chatgpt.site/*";

/** @param {Record<string, any>} manifest */
export function createPublicManifest(manifest) {
  const result = JSON.parse(JSON.stringify(manifest));
  result.host_permissions = [COINGLASS_TV, DEPTHWATCH_TEST, DEPTHWATCH_PRODUCTION, MARKETDEPTH];
  result.content_scripts = (result.content_scripts ?? []).map(/** @param {Record<string, any>} script */ (script) => {
    if ((script.js ?? []).includes("depthwatch-content.js")) {
      return { ...script, matches: [DEPTHWATCH_TEST, DEPTHWATCH_PRODUCTION, MARKETDEPTH] };
    }
    if ((script.js ?? []).includes("coinglass-page.js")) {
      return { ...script, matches: [COINGLASS_TV] };
    }
    return script;
  });
  return result;
}
