/** Crypto (CoinGecko) + stocks (Stooq) helpers used by MarketsAdapter and tools. */

const CRYPTO_ALIASES: Record<string, string> = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  doge: "dogecoin",
  dogecoin: "dogecoin",
  xrp: "ripple",
  ripple: "ripple",
  ada: "cardano",
  cardano: "cardano",
  avax: "avalanche-2",
  avalanche: "avalanche-2",
  matic: "matic-network",
  polygon: "matic-network",
  link: "chainlink",
  chainlink: "chainlink",
  dot: "polkadot",
  polkadot: "polkadot",
  ltc: "litecoin",
  litecoin: "litecoin",
  bnb: "binancecoin",
  "binance coin": "binancecoin",
};

const STOCK_ALIASES: Record<string, string> = {
  aapl: "aapl.us",
  apple: "aapl.us",
  msft: "msft.us",
  microsoft: "msft.us",
  googl: "googl.us",
  goog: "goog.us",
  google: "googl.us",
  amzn: "amzn.us",
  amazon: "amzn.us",
  tsla: "tsla.us",
  tesla: "tsla.us",
  meta: "meta.us",
  nvda: "nvda.us",
  nvidia: "nvda.us",
  nflx: "nflx.us",
  netflix: "nflx.us",
};

export type MarketQuote = {
  kind: "crypto" | "stock";
  id: string;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  change24h?: number;
  sparkline: { labels: string[]; values: number[] };
  url: string;
};

function cleanQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(price|of|the|for|current|today|now|chart|how much is|whats|what's|show me)\b/g, " ")
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveMarketQuery(query: string): {
  kind: "crypto" | "stock";
  id: string;
  symbol: string;
} | null {
  const q = cleanQuery(query);
  if (!q) return null;

  if (CRYPTO_ALIASES[q]) {
    const id = CRYPTO_ALIASES[q]!;
    return { kind: "crypto", id, symbol: q.toUpperCase().slice(0, 8) };
  }
  for (const [alias, id] of Object.entries(CRYPTO_ALIASES)) {
    if (q.includes(alias)) {
      return { kind: "crypto", id, symbol: alias.toUpperCase() };
    }
  }

  if (STOCK_ALIASES[q]) {
    return { kind: "stock", id: STOCK_ALIASES[q]!, symbol: q.toUpperCase() };
  }
  for (const [alias, id] of Object.entries(STOCK_ALIASES)) {
    if (q.includes(alias)) {
      return { kind: "stock", id, symbol: alias.toUpperCase() };
    }
  }

  // bare ticker like "nvda" or "btc-usd"
  const ticker = q.replace(/\s+/g, "");
  if (/^[a-z]{1,5}$/.test(ticker) && STOCK_ALIASES[ticker]) {
    return { kind: "stock", id: STOCK_ALIASES[ticker]!, symbol: ticker.toUpperCase() };
  }
  if (/^[a-z]{2,12}$/.test(ticker) && CRYPTO_ALIASES[ticker]) {
    return { kind: "crypto", id: CRYPTO_ALIASES[ticker]!, symbol: ticker.toUpperCase() };
  }

  // default ambiguous short tokens to crypto coin id guess
  if (/^[a-z][a-z0-9-]{1,30}$/.test(ticker) && !ticker.includes(".")) {
    return { kind: "crypto", id: ticker, symbol: ticker.toUpperCase() };
  }

  return null;
}

async function fetchCrypto(id: string, symbol: string): Promise<MarketQuote> {
  const [priceRes, chartRes] = await Promise.all([
    fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`,
    ),
    fetch(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=7`,
    ),
  ]);

  if (!priceRes.ok) {
    throw new Error(`CoinGecko price failed: ${priceRes.status}`);
  }
  const priceJson = (await priceRes.json()) as Record<
    string,
    { usd?: number; usd_24h_change?: number }
  >;
  const row = priceJson[id];
  if (row?.usd == null) {
    throw new Error(`Unknown crypto “${id}”`);
  }

  let labels: string[] = [];
  let values: number[] = [];
  if (chartRes.ok) {
    const chart = (await chartRes.json()) as {
      prices?: Array<[number, number]>;
    };
    const points = chart.prices ?? [];
    // ~7 daily samples
    const step = Math.max(1, Math.floor(points.length / 7));
    const sampled = points.filter((_, i) => i % step === 0).slice(-7);
    labels = sampled.map(([ts]) =>
      new Date(ts).toLocaleDateString("en-US", { weekday: "short" }),
    );
    values = sampled.map(([, p]) => Math.round(p * 100) / 100);
  }

  if (values.length === 0) {
    labels = ["Now"];
    values = [row.usd];
  }

  return {
    kind: "crypto",
    id,
    symbol,
    name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    price: row.usd,
    currency: "USD",
    change24h:
      typeof row.usd_24h_change === "number"
        ? Math.round(row.usd_24h_change * 100) / 100
        : undefined,
    sparkline: { labels, values },
    url: `https://www.coingecko.com/en/coins/${id}`,
  };
}

async function fetchStock(stooqId: string, symbol: string): Promise<MarketQuote> {
  const res = await fetch(
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqId)}&i=d`,
  );
  if (!res.ok) throw new Error(`Stooq failed: ${res.status}`);
  const csv = await res.text();
  const lines = csv
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Date,Open,High,Low,Close,Volume
  const rows = lines.slice(1).map((line) => {
    const [date, , , , close] = line.split(",");
    return { date, close: Number(close) };
  }).filter((r) => Number.isFinite(r.close));

  if (rows.length === 0) {
    throw new Error(`No quote for ${symbol}`);
  }

  const recent = rows.slice(-7);
  const last = recent[recent.length - 1]!;
  const prev = recent.length > 1 ? recent[recent.length - 2]! : last;
  const change =
    prev.close !== 0
      ? Math.round(((last.close - prev.close) / prev.close) * 10000) / 100
      : undefined;

  return {
    kind: "stock",
    id: stooqId,
    symbol: symbol.toUpperCase(),
    name: symbol.toUpperCase(),
    price: last.close,
    currency: "USD",
    change24h: change,
    sparkline: {
      labels: recent.map((r) => {
        const d = new Date(r.date!);
        return Number.isNaN(d.getTime())
          ? (r.date ?? "")
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }),
      values: recent.map((r) => Math.round(r.close * 100) / 100),
    },
    url: `https://stooq.com/q/?s=${encodeURIComponent(stooqId)}`,
  };
}

export async function lookupMarketQuote(query: string): Promise<MarketQuote> {
  const resolved = resolveMarketQuery(query);
  if (!resolved) {
    throw new Error(`Could not parse market query: “${query}”`);
  }
  if (resolved.kind === "crypto") {
    return fetchCrypto(resolved.id, resolved.symbol);
  }
  return fetchStock(resolved.id, resolved.symbol);
}

export type FxQuote = {
  base: string;
  rates: Record<string, number>;
  date: string;
  url: string;
};

const CURRENCY_CODES = new Set([
  "usd", "eur", "gbp", "jpy", "chf", "cad", "aud", "nzd", "cny", "inr", "krw", "sek", "nok", "mxn", "brl", "zar", "try", "pln", "sgd", "hkd",
]);

export function resolveFxQuery(query: string): { base: string; quotes: string[] } | null {
  const lower = query.toLowerCase();
  const codes = [...lower.matchAll(/\b([a-z]{3})\b/g)]
    .map((m) => m[1]!)
    .filter((c) => CURRENCY_CODES.has(c));

  const pair = lower.match(/\b([a-z]{3})\s*(?:to|\/|in|->)\s*([a-z]{3})\b/);
  if (pair && CURRENCY_CODES.has(pair[1]!) && CURRENCY_CODES.has(pair[2]!)) {
    return { base: pair[1]!.toUpperCase(), quotes: [pair[2]!.toUpperCase()] };
  }

  if (codes.length >= 2) {
    return {
      base: codes[0]!.toUpperCase(),
      quotes: [...new Set(codes.slice(1).map((c) => c.toUpperCase()))],
    };
  }

  if (/\b(exchange|fx|forex|currency|convert)\b/.test(lower)) {
    return { base: "USD", quotes: ["EUR", "GBP", "JPY"] };
  }

  return null;
}

export async function lookupFx(base: string, quotes: string[]): Promise<FxQuote> {
  const to = (quotes.length ? quotes : ["EUR", "GBP"]).join(",");
  const res = await fetch(
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(to)}`,
  );
  if (!res.ok) throw new Error(`FX lookup failed: ${res.status}`);
  const json = (await res.json()) as {
    base?: string;
    date?: string;
    rates?: Record<string, number>;
  };
  if (!json.rates) throw new Error("FX response missing rates");
  return {
    base: (json.base ?? base).toUpperCase(),
    rates: json.rates,
    date: json.date ?? new Date().toISOString().slice(0, 10),
    url: "https://www.frankfurter.app/",
  };
}
