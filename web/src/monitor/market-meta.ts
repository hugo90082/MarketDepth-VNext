export const MARKET_META_PRIORITY = [
  "Binance",
  "OKX",
  "Bybit",
  "Coinbase",
  "Bitfinex",
  "Kraken",
] as const;

export type MarketMetaExchange = typeof MARKET_META_PRIORITY[number];
export type MarketMetaCandidate = {
  symbol: string;
  exchange: MarketMetaExchange;
  pair: string;
  price: number;
  predictedFundingRate: number | null;
  fundingIntervalHours: number | null;
  generatedAt: number;
  error?: string;
};

export type MarketMetaDisplay = {
  symbol: string;
  exchange: MarketMetaExchange;
  pair: string;
  price: number;
  fundingRate8h: number | null;
  generatedAt: number;
  status: "ok" | "stale";
  failureCount: number;
};

export type MarketMetaBatchResponse = {
  generatedAt: number;
  items: Record<string, MarketMetaCandidate[]>;
  errors?: Partial<Record<MarketMetaExchange, string>>;
};

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

function trimFraction(value: string) {
  return value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
}

function subscript(value: number) {
  return String(value).split("").map((digit) => SUBSCRIPT_DIGITS[digit] ?? digit).join("");
}

export function formatMarketPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 10_000) return value.toFixed(1);
  if (value >= 1_000) return trimFraction(value.toFixed(2));
  if (value >= 1) return trimFraction(value.toFixed(4));

  const exponential = value.toExponential(4);
  const [mantissa, exponentText] = exponential.split("e");
  const exponent = Number(exponentText);
  const leadingZeroes = exponent < 0 ? -exponent - 1 : 0;
  if (leadingZeroes >= 4) {
    const digits = mantissa.replace(".", "").replace(/^0+/, "");
    return `0.0${subscript(leadingZeroes)}${digits}`;
  }
  return trimFraction(value.toFixed(8));
}

export function normalizeFundingRate8h(
  rate: number | null | undefined,
  intervalHours: number | null | undefined,
) {
  if (
    typeof rate !== "number"
    || !Number.isFinite(rate)
    || typeof intervalHours !== "number"
    || !Number.isFinite(intervalHours)
    || intervalHours <= 0
  ) {
    return null;
  }
  return rate * 8 / intervalHours;
}

export function formatFundingRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const percent = value * 100;
  const prefix = percent > 0 ? "+" : "";
  return `${prefix}${percent.toFixed(4)}%`;
}

function candidateDisplay(candidate: MarketMetaCandidate): MarketMetaDisplay {
  return {
    symbol: candidate.symbol,
    exchange: candidate.exchange,
    pair: candidate.pair,
    price: candidate.price,
    fundingRate8h: normalizeFundingRate8h(
      candidate.predictedFundingRate,
      candidate.fundingIntervalHours,
    ),
    generatedAt: candidate.generatedAt,
    status: "ok",
    failureCount: 0,
  };
}

function priority(exchange: MarketMetaExchange) {
  return MARKET_META_PRIORITY.indexOf(exchange);
}

export function resolveMarketMeta(
  previous: MarketMetaDisplay | null,
  candidates: readonly MarketMetaCandidate[],
  now: number,
  refreshSeconds: number,
) {
  const usable = candidates
    .filter((candidate) => Number.isFinite(candidate.price) && candidate.price > 0)
    .sort((left, right) => priority(left.exchange) - priority(right.exchange));
  const best = usable[0];
  if (!previous) return best ? candidateDisplay(best) : null;

  const recoveredHigher = usable.find(
    (candidate) => priority(candidate.exchange) < priority(previous.exchange),
  );
  if (recoveredHigher) return candidateDisplay(recoveredHigher);

  const sameSource = usable.find(
    (candidate) => candidate.exchange === previous.exchange,
  );
  if (sameSource) return candidateDisplay(sameSource);

  const failureCount = previous.failureCount + 1;
  const staleLimitMs = Math.min(
    Math.max(0, refreshSeconds) * 2 * 1000,
    120_000,
  );
  if (failureCount < 2 && now - previous.generatedAt <= staleLimitMs) {
    return {
      ...previous,
      status: "stale" as const,
      failureCount,
    };
  }
  return best ? candidateDisplay(best) : null;
}
