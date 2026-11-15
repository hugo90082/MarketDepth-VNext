export type OkxBookDisposition = "ok" | "rate_limit" | "unsupported" | "upstream";

export function classifyOkxBookResponse(payload: { code?: unknown; data?: unknown }): OkxBookDisposition {
  const code = String(payload?.code ?? "");
  if (code === "0" && Array.isArray(payload.data) && payload.data.length > 0) return "ok";
  if (code === "50011") return "rate_limit";
  if (code === "51001") return "unsupported";
  return "upstream";
}

/** Only an explicit unknown-pair error is evidence that a market is unsupported. */
export function classifyKrakenBookResponse(payload: { error?: unknown; result?: {bids?: unknown[]; asks?: unknown[]} }): OkxBookDisposition {
  const errors = Array.isArray(payload?.error) ? payload.error.map(String) : [];
  if (errors.some(e => /rate limit|throttl/i.test(e))) return 'rate_limit';
  if (errors.some(e => /^EQuery:Unknown asset pair$/i.test(e))) return 'unsupported';
  if (errors.length || !payload?.result?.bids?.length || !payload?.result?.asks?.length) return 'upstream';
  return 'ok';
}
