// Quick Debug console: a strict allowlist of the panel's own commands.
// This is not a shell. Input is parsed into a typed command or rejected; nothing
// is ever evaluated, and no command can reach the page, the OS or the network.
import type { StatusView } from "./filter.js";
import type { ThemePref } from "./prefs.js";

export type Command =
  | { name: "/help"; topic: string | null }
  | { name: "/show"; view: StatusView }
  | { name: "/type"; type: string }
  | { name: "/search"; text: string }
  | { name: "/slowest"; count: number }
  | { name: "/reset" }
  | { name: "/select"; index: number }
  | { name: "/copy" }
  | { name: "/download"; format: "md" | "json"; scope: "selected" | "visible" }
  | { name: "/explain"; code: string }
  | { name: "/theme"; theme: ThemePref }
  | { name: "/pin"; target: string }
  | { name: "/unpin"; target: string }
  | { name: "/pins" }
  | { name: "/reset-usage" }
  | { name: "/clear" }
  | { name: "/cls" }
  | { name: "/spooky" };

export type CommandName = Command["name"];

export interface CommandInfo {
  name: CommandName;
  usage: string;
  summary: string;
}

export const COMMANDS: CommandInfo[] = [
  { name: "/help", usage: "/help [command]", summary: "List commands, or explain one." },
  { name: "/show", usage: "/show all|problems|failed|errors|redirects|slow", summary: "Switch the request view." },
  { name: "/type", usage: "/type <resource type>|all", summary: "Filter by resource type (e.g. fetch, script, image)." },
  { name: "/search", usage: "/search [text]", summary: "Set the search text; no text clears it." },
  { name: "/slowest", usage: "/slowest [1-20]", summary: "List the slowest captured requests (default 5)." },
  { name: "/reset", usage: "/reset", summary: "Reset view, type and search filters." },
  { name: "/select", usage: "/select <row number>", summary: "Select a visible request by its position." },
  { name: "/copy", usage: "/copy", summary: "Copy the redacted report of the selected request." },
  { name: "/download", usage: "/download [md|json] [all]", summary: "Download a redacted technical report (selected request, or all visible with 'all')." },
  { name: "/explain", usage: "/explain <status|net::ERR_…>", summary: "Explain an HTTP status code or Chrome network error." },
  { name: "/theme", usage: "/theme auto|light|dark", summary: "Choose the colour theme." },
  { name: "/pin", usage: "/pin <command>", summary: "Pin a command as a one-click shortcut (max 4)." },
  { name: "/unpin", usage: "/unpin <command>", summary: "Remove a pinned shortcut." },
  { name: "/pins", usage: "/pins", summary: "List pinned shortcuts." },
  { name: "/reset-usage", usage: "/reset-usage", summary: "Forget locally stored command-usage counts." },
  { name: "/clear", usage: "/clear", summary: "Clear the request list (does not affect the Network panel)." },
  { name: "/cls", usage: "/cls", summary: "Clear this console's output." },
  { name: "/spooky", usage: "/spooky", summary: "A small Halloween surprise (until Nov 1, 2026)." },
];

const VIEW_ALIASES: Record<string, StatusView> = {
  all: "all",
  problems: "problems",
  failed: "failed",
  "no-response": "failed",
  errors: "http-error",
  "http-errors": "http-error",
  redirects: "redirect",
  slow: "slow",
};

export const MAX_INPUT = 300;

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string };

const NOT_A_SHELL =
  "Quick Debug's console only runs its own commands (type /help). It cannot run shell commands or JavaScript.";

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function usage(name: string): string {
  const info = COMMANDS.find((c) => c.name === name);
  return info ? `Usage: ${info.usage}` : "";
}

function suggest(name: string): string {
  const close = COMMANDS.filter((c) => c.name.startsWith(name.slice(0, 3)));
  return close.length ? ` Did you mean ${close.map((c) => c.name).join(", ")}?` : "";
}

/** Parse console input into a command. Never throws. */
export function parseCommand(input: string): ParseResult {
  const text = input.trim();
  if (text === "") return fail("Type a command, for example /help.");
  if (text.length > MAX_INPUT) return fail(`Input is too long (max ${MAX_INPUT} characters).`);
  if (/[\u0000-\u001f\u007f]/.test(text)) return fail("Input contains control characters.");
  if (!text.startsWith("/")) return fail(NOT_A_SHELL);

  const [rawName = "", ...args] = text.split(/\s+/);
  const name = rawName.toLowerCase();
  const argc = args.length;
  const none = (cmd: Command): ParseResult => (argc === 0 ? { ok: true, command: cmd } : fail(`${name} takes no arguments. ${usage(name)}`));

  switch (name) {
    case "/help": {
      if (argc > 1) return fail(usage(name));
      if (argc === 0) return { ok: true, command: { name, topic: null } };
      const topic = args[0]!.toLowerCase();
      const full = topic.startsWith("/") ? topic : "/" + topic;
      return COMMANDS.some((c) => c.name === full) ? { ok: true, command: { name, topic: full } } : fail(`No command named ${full}.${suggest(full)}`);
    }
    case "/show":
    case "/filter": {
      const view = argc === 1 ? VIEW_ALIASES[args[0]!.toLowerCase()] : undefined;
      return view ? { ok: true, command: { name: "/show", view } } : fail(usage("/show"));
    }
    case "/type": {
      if (argc !== 1 || !/^[a-z][a-z0-9-]{0,29}$/i.test(args[0]!)) return fail(usage(name));
      return { ok: true, command: { name, type: args[0]!.toLowerCase() } };
    }
    case "/search": {
      const value = text.slice(rawName.length).trim();
      if (value.length > 200) return fail("Search text is too long (max 200 characters).");
      return { ok: true, command: { name, text: value } };
    }
    case "/slowest": {
      if (argc === 0) return { ok: true, command: { name, count: 5 } };
      if (argc === 1 && /^\d{1,2}$/.test(args[0]!)) {
        const count = Number(args[0]);
        if (count >= 1 && count <= 20) return { ok: true, command: { name, count } };
      }
      return fail(usage(name));
    }
    case "/select": {
      if (argc === 1 && /^\d{1,6}$/.test(args[0]!) && Number(args[0]) >= 1) return { ok: true, command: { name, index: Number(args[0]) } };
      return fail(usage(name));
    }
    case "/download": {
      let format: "md" | "json" = "md";
      let scope: "selected" | "visible" = "selected";
      for (const a of args.map((x) => x.toLowerCase())) {
        if (a === "md" || a === "markdown") format = "md";
        else if (a === "json") format = "json";
        else if (a === "all") scope = "visible";
        else return fail(usage(name));
      }
      if (argc > 2) return fail(usage(name));
      return { ok: true, command: { name, format, scope } };
    }
    case "/explain": {
      if (argc !== 1 || !/^(\d{3}|(net::)?err_[a-z0-9_]{1,60})$/i.test(args[0]!)) return fail(usage(name));
      return { ok: true, command: { name, code: args[0]! } };
    }
    case "/theme": {
      const t = args[0]?.toLowerCase();
      if (argc === 1 && (t === "auto" || t === "light" || t === "dark")) return { ok: true, command: { name, theme: t } };
      return fail(usage(name));
    }
    case "/pin":
    case "/unpin": {
      const target = text.slice(rawName.length).trim();
      if (!target) return fail(usage(name));
      return { ok: true, command: { name, target } };
    }
    case "/reset":
    case "/copy":
    case "/pins":
    case "/reset-usage":
    case "/clear":
    case "/cls":
    case "/spooky":
      return none({ name } as Command);
    default:
      return fail(`Unknown command ${name}.${suggest(name)} Type /help for the list.`);
  }
}

/**
 * Canonical text for a pinnable command, or null. Commands carrying free text
 * (/search) or acting on a specific row (/select) cannot be pinned, so nothing
 * typed by the user or taken from a request is ever persisted.
 */
export function pinnableText(command: Command): string | null {
  switch (command.name) {
    case "/show": {
      const alias = Object.entries(VIEW_ALIASES).find(([, v]) => v === command.view)?.[0];
      return `/show ${alias}`;
    }
    case "/type":
      return `/type ${command.type}`;
    case "/slowest":
      return `/slowest ${command.count}`;
    case "/download":
      return `/download ${command.format}${command.scope === "visible" ? " all" : ""}`;
    case "/theme":
      return `/theme ${command.theme}`;
    case "/reset":
    case "/copy":
    case "/spooky":
    case "/clear":
    case "/help":
      return command.name;
    default:
      return null;
  }
}
