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
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)]
      .map((m) => m[1])
      .slice(1, 16);
    const links = [...xml.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/g)]
      .map((m) => m[1])
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

/** Open-Meteo — free, no API key. */
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
        latitude: number;
        longitude: number;
      }>;
    };
    const hit = geo.results?.[0];
    if (!hit) throw new Error(`No location found for “${place}”`);

    const label = [hit.name, hit.country].filter(Boolean).join(", ");
    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`,
    );
    if (!wxRes.ok) throw new Error(`Weather forecast failed: ${wxRes.status}`);
    const wx = (await wxRes.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        time?: string;
      };
      current_units?: {
        temperature_2m?: string;
        wind_speed_10m?: string;
      };
    };
    const cur = wx.current;
    if (!cur) throw new Error("Weather response missing current conditions");

    const condition = weatherCodeLabel(cur.weather_code ?? 0);
    const temp = cur.temperature_2m;
    const unit = wx.current_units?.temperature_2m ?? "°C";

    return {
      source: this.type,
      events: [
        {
          event_type: "current",
          ts: cur.time ? new Date(cur.time) : new Date(),
          payload: {
            location: label,
            title: `${label}: ${temp}${unit}, ${condition}`,
            summary: condition,
            temperature: temp,
            temperatureUnit: unit,
            humidity: cur.relative_humidity_2m,
            windSpeed: cur.wind_speed_10m,
            windUnit: wx.current_units?.wind_speed_10m ?? "km/h",
            weatherCode: cur.weather_code,
            url: `https://open-meteo.com/`,
          },
        },
        {
          event_type: "condition",
          ts: new Date(),
          payload: {
            location: label,
            title: condition,
            summary: `Conditions in ${label}`,
          },
        },
        {
          event_type: "humidity",
          ts: new Date(),
          payload: {
            location: label,
            title: `Humidity ${cur.relative_humidity_2m ?? "—"}%`,
          },
        },
        {
          event_type: "wind",
          ts: new Date(),
          payload: {
            location: label,
            title: `Wind ${cur.wind_speed_10m ?? "—"} ${wx.current_units?.wind_speed_10m ?? "km/h"}`,
          },
        },
      ],
    };
  }
}

function weatherCodeLabel(code: number): string {
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

const adapters: Record<string, SourceAdapter> = {
  hackernews: new HackerNewsAdapter(),
  rss: new RssAdapter(),
  github: new GitHubAdapter(),
  weather: new WeatherAdapter(),
};

export function getSourceAdapter(type: string): SourceAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown source adapter: ${type}`);
  return adapter;
}
