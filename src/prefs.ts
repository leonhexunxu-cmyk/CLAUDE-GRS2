// Local, per-browser preferences: theme, pinned commands and command-usage
// counts. Stored only in the extension's own localStorage; holds command names
// and fixed arguments, never request data or typed search text.

export type ThemePref = "auto" | "light" | "dark";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEYS = { theme: "qd.theme", pins: "qd.pins", usage: "qd.usage" } as const;
export const MAX_PINS = 4;

export class Prefs {
  constructor(private storage: StorageLike | null) {}

  private read(key: string): unknown {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): boolean {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
      return Boolean(this.storage);
    } catch {
      return false;
    }
  }

  get theme(): ThemePref {
    const t = this.read(KEYS.theme);
    return t === "light" || t === "dark" ? t : "auto";
  }

  setTheme(theme: ThemePref): void {
    this.write(KEYS.theme, theme);
  }

  /** Pins are re-validated by the caller (only pinnable commands are accepted). */
  get pins(): string[] {
    const p = this.read(KEYS.pins);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string" && x.length <= 40).slice(0, MAX_PINS) : [];
  }

  setPins(pins: string[]): void {
    this.write(KEYS.pins, pins.slice(0, MAX_PINS));
  }

  get usage(): Record<string, number> {
    const u = this.read(KEYS.usage);
    if (!u || typeof u !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
      if (/^\/[a-z-]+$/.test(k) && typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    }
    return out;
  }

  /** Count one use of a command, by name only. */
  recordUse(name: string): void {
    if (!/^\/[a-z-]+$/.test(name)) return;
    const usage = this.usage;
    usage[name] = (usage[name] ?? 0) + 1;
    this.write(KEYS.usage, usage);
  }

  resetUsage(): void {
    try {
      this.storage?.removeItem(KEYS.usage);
    } catch {
      /* nothing stored */
    }
  }

  /** Most used command names, most frequent first. */
  topCommands(n: number, exclude: string[] = []): string[] {
    return Object.entries(this.usage)
      .filter(([name]) => !exclude.includes(name))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([name]) => name);
  }
}
