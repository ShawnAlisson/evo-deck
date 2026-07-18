import {
  lookupFx,
  lookupMarketQuote,
  resolveFxQuery,
  resolveMarketQuery,
} from "@/lib/sources/markets";

export type SourceSyncResult = {
  source: string;
  events: Array<{
    event_type: string;
    ts: Date;
    payload: Record<string, unknown>;
  }>;
};

export interface SourceAdapter {
  readonly type: string;
  sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult>;
}

export class HackerNewsAdapter implements SourceAdapter {
  readonly type = "hackernews";

  async sync(_input?: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const res = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
    );
    if (!res.ok) throw new Error(`HN topstories failed: ${res.status}`);
    const ids = (await res.json()) as number[];
    const top = ids.slice(0, 20);
    const items = await Promise.all(
      top.map(async (id) => {
        const itemRes = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        );
        return itemRes.json();
      }),
    );

    return {
      source: this.type,
      events: items
        .filter(Boolean)
        .map((item: { id: number; title?: string; url?: string; score?: number; by?: string; time?: number }) => ({
          event_type: "story",
          ts: new Date((item.time ?? Math.floor(Date.now() / 1000)) * 1000),
          payload: {
            id: item.id,
            title: item.title ?? "Untitled",
            url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
            score: item.score ?? 0,
            by: item.by ?? "unknown",
          },
        })),
    };
  }
}

function stripXml(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export class RssAdapter implements SourceAdapter {
  readonly type = "rss";

  async sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const feedUrl =
      typeof input.config?.url === "string"
        ? input.config.url
        : "https://hnrss.org/frontpage";
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const xml = await res.text();

    // Prefer <item> / <entry> blocks; support CDATA and plain titles
    const blocks = [
      ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
      ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
    ].map((m) => m[0]);

    const events = (blocks.length ? blocks : [xml])
      .slice(0, 16)
      .map((block) => {
        const titleRaw =
          block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
        const linkRaw =
          block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ??
          block.match(/<link[^>]*>(https?:\/\/[^<]+)<\/link>/i)?.[1] ??
          feedUrl;
        const title = stripXml(titleRaw) || "Untitled";
        return {
          event_type: "item",
          ts: new Date(),
          payload: {
            title,
            url: linkRaw.trim(),
          },
        };
      })
      .filter((e) => e.payload.title !== "Untitled");

    // Fallback to old CDATA scrape if block parse yielded nothing
    if (events.length === 0) {
      const titles = [
        ...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g),
      ]
        .map((m) => m[1]!)
        .slice(1, 16);
      const links = [...xml.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/g)]
        .map((m) => m[1]!)
        .slice(1, 16);
      return {
        source: this.type,
        events: titles.map((title, i) => ({
          event_type: "item",
          ts: new Date(),
          payload: {
            title,
            url: links[i] ?? feedUrl,
          },
        })),
      };
    }

    return { source: this.type, events };
  }
}

export class GitHubAdapter implements SourceAdapter {
  readonly type = "github";

  async sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const user =
      typeof input.config?.user === "string" ? input.config.user : "vercel";
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(user)}/events/public`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "echoes-app",
        },
      },
    );
    if (!res.ok) throw new Error(`GitHub events failed: ${res.status}`);
    const events = (await res.json()) as Array<{
      id: string;
      type: string;
      created_at: string;
      repo?: { name: string };
      payload?: { action?: string; ref?: string };
    }>;

    return {
      source: this.type,
      events: events.slice(0, 30).map((e) => {
        const repo = e.repo?.name ?? "unknown";
        const kind = e.type.replace(/Event$/, "");
        return {
          event_type: e.type,
          ts: new Date(e.created_at),
          payload: {
            id: e.id,
            repo,
            type: e.type,
            title: `${kind} · ${repo}`,
            url: `https://github.com/${repo}`,
          },
        };
      }),
    };
  }
}

export function weatherCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

/** WMO weather code → emoji for GenUI labels */
export function weatherCodeEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 86) return "🌨️";
  if (code <= 99) return "⛈️";
  return "🌡️";
}

/** Open-Meteo — free, no API key. Includes hourly forecast. */
export class WeatherAdapter implements SourceAdapter {
  readonly type = "weather";

  async sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const place =
      typeof input.config?.location === "string" && input.config.location.trim()
        ? input.config.location.trim()
        : "London";

    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
    );
    if (!geoRes.ok) throw new Error(`Weather geocode failed: ${geoRes.status}`);
    const geo = (await geoRes.json()) as {
      results?: Array<{
        name: string;
        country?: string;
        admin1?: string;
        latitude: number;
        longitude: number;
      }>;
    };
    const hit = geo.results?.[0];
    if (!hit) throw new Error(`No location found for “${place}”`);

    const label = [hit.name, hit.admin1 !== hit.name ? hit.admin1 : null, hit.country]
      .filter(Boolean)
      .join(", ");
    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature&hourly=temperature_2m,weather_code&forecast_days=1&timezone=auto`,
    );
    if (!wxRes.ok) throw new Error(`Weather forecast failed: ${wxRes.status}`);
    const wx = (await wxRes.json()) as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        time?: string;
      };
      current_units?: {
        temperature_2m?: string;
        wind_speed_10m?: string;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        weather_code?: number[];
      };
    };
    const cur = wx.current;
    if (!cur) throw new Error("Weather response missing current conditions");

    const code = cur.weather_code ?? 0;
    const condition = weatherCodeLabel(code);
    const emoji = weatherCodeEmoji(code);
    const temp = cur.temperature_2m;
    const unit = wx.current_units?.temperature_2m ?? "°C";

    // Next 12 hours from now
    const hourlyLabels: string[] = [];
    const hourlyTemps: number[] = [];
    const now = Date.now();
    const times = wx.hourly?.time ?? [];
    const temps = wx.hourly?.temperature_2m ?? [];
    for (let i = 0; i < times.length && hourlyTemps.length < 12; i++) {
      const t = new Date(times[i]!).getTime();
      if (t < now - 60 * 60 * 1000) continue;
      const hour = new Date(times[i]!).toLocaleTimeString("en-US", {
        hour: "numeric",
        hour12: true,
      });
      hourlyLabels.push(hour);
      hourlyTemps.push(Math.round((temps[i] ?? 0) * 10) / 10);
    }

    return {
      source: this.type,
      events: [
        {
          event_type: "current",
          ts: cur.time ? new Date(cur.time) : new Date(),
          payload: {
            location: label,
            title: `${emoji} ${label}`,
            summary: condition,
            condition,
            emoji,
            temperature: temp,
            feelsLike: cur.apparent_temperature,
            temperatureUnit: unit,
            humidity: cur.relative_humidity_2m,
            windSpeed: cur.wind_speed_10m,
            windUnit: wx.current_units?.wind_speed_10m ?? "km/h",
            weatherCode: code,
            hourlyLabels,
            hourlyTemps,
            url: `https://open-meteo.com/`,
          },
        },
      ],
    };
  }
}

/** CoinGecko crypto + Stooq stocks */
export class MarketsAdapter implements SourceAdapter {
  readonly type = "markets";

  async sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const query =
      typeof input.config?.query === "string" && input.config.query.trim()
        ? input.config.query.trim()
        : "bitcoin";

    const quote = await lookupMarketQuote(query);
    const change =
      quote.change24h != null
        ? `${quote.change24h >= 0 ? "+" : ""}${quote.change24h}%`
        : undefined;

    return {
      source: this.type,
      events: [
        {
          event_type: "quote",
          ts: new Date(),
          payload: {
            kind: quote.kind,
            id: quote.id,
            symbol: quote.symbol,
            name: quote.name,
            title: `${quote.name} (${quote.symbol})`,
            price: quote.price,
            currency: quote.currency,
            change24h: quote.change24h,
            changeLabel: change,
            sparklineLabels: quote.sparkline.labels,
            sparklineValues: quote.sparkline.values,
            url: quote.url,
            summary: `${quote.price} ${quote.currency}${change ? ` · ${change}` : ""}`,
          },
        },
      ],
    };
  }
}

/** Frankfurter FX rates */
export class FxAdapter implements SourceAdapter {
  readonly type = "fx";

  async sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const query =
      typeof input.config?.query === "string" ? input.config.query : "USD to EUR";
    const resolved =
      resolveFxQuery(query) ??
      (typeof input.config?.base === "string"
        ? {
            base: String(input.config.base),
            quotes: Array.isArray(input.config.quotes)
              ? (input.config.quotes as string[])
              : ["EUR", "GBP"],
          }
        : { base: "USD", quotes: ["EUR", "GBP", "JPY"] });

    const fx = await lookupFx(resolved.base, resolved.quotes);
    const entries = Object.entries(fx.rates);

    return {
      source: this.type,
      events: [
        {
          event_type: "rates",
          ts: new Date(),
          payload: {
            base: fx.base,
            date: fx.date,
            title: `${fx.base} exchange rates`,
            rates: fx.rates,
            rateLabels: entries.map(([k]) => k),
            rateValues: entries.map(([, v]) => v),
            url: fx.url,
            summary: entries
              .map(([k, v]) => `1 ${fx.base} = ${v} ${k}`)
              .join(" · "),
          },
        },
        ...entries.map(([code, rate]) => ({
          event_type: "rate",
          ts: new Date(),
          payload: {
            base: fx.base,
            quote: code,
            rate,
            title: `1 ${fx.base} = ${rate} ${code}`,
            url: fx.url,
          },
        })),
      ],
    };
  }
}

/** Wikipedia summary — general facts without hallucinating */
export class WikipediaAdapter implements SourceAdapter {
  readonly type = "wikipedia";

  async sync(input: {
    workspaceId: string;
    config?: Record<string, unknown>;
  }): Promise<SourceSyncResult> {
    const topic =
      typeof input.config?.topic === "string" && input.config.topic.trim()
        ? input.config.topic.trim()
        : "Echo";

    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.replace(/\s+/g, "_"))}`,
      { headers: { Accept: "application/json", "User-Agent": "echoes-app" } },
    );
    if (!res.ok) throw new Error(`Wikipedia failed: ${res.status}`);
    const json = (await res.json()) as {
      title?: string;
      extract?: string;
      description?: string;
      content_urls?: { desktop?: { page?: string } };
      thumbnail?: { source?: string };
    };

    return {
      source: this.type,
      events: [
        {
          event_type: "summary",
          ts: new Date(),
          payload: {
            title: json.title ?? topic,
            summary: json.extract ?? json.description ?? "",
            description: json.description,
            thumbnail: json.thumbnail?.source,
            url: json.content_urls?.desktop?.page,
          },
        },
      ],
    };
  }
}

const adapters: Record<string, SourceAdapter> = {
  hackernews: new HackerNewsAdapter(),
  rss: new RssAdapter(),
  github: new GitHubAdapter(),
  weather: new WeatherAdapter(),
  markets: new MarketsAdapter(),
  fx: new FxAdapter(),
  wikipedia: new WikipediaAdapter(),
};

export function getSourceAdapter(type: string): SourceAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown source adapter: ${type}`);
  return adapter;
}

export function listSourceAdapters(): string[] {
  return Object.keys(adapters);
}

export { resolveMarketQuery, resolveFxQuery };
