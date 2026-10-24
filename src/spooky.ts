// /spooky: a short, single-instance Halloween animation. Isolated from capture,
// diagnostics and reports. It draws in its own lane (passed in by the caller),
// so it never covers controls or data, and it cleans up after itself.
import { isHalloweenSeason } from "./season.js";

export type SpookyResult = "animated" | "static" | "busy" | "expired";

const GHOST_PATH = "M9 1.5c-3.6 0-6 2.7-6 6.2V16l2-1.4 2 1.4 2-1.4 2 1.4 2-1.4 2 1.4V7.7c0-3.5-2.4-6.2-6-6.2Z";
export const DURATION_MS = 2600;

let running: Animation | null = null;

export function ghostSvg(className: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const body = document.createElementNS(ns, "path");
  body.setAttribute("d", GHOST_PATH);
  const eyes = document.createElementNS(ns, "path");
  eyes.setAttribute("d", "M7 7.5h.01M11 7.5h.01");
  eyes.setAttribute("stroke-linecap", "round");
  eyes.setAttribute("stroke-width", "2");
  svg.append(body, eyes);
  return svg;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Run the effect in `lane` (an element owned by the caller). Repeated calls while
 * the ghost is still floating do nothing. `onDone` runs once the lane is empty.
 */
export function runSpooky(lane: HTMLElement, onDone: () => void, now: Date = new Date()): SpookyResult {
  if (!isHalloweenSeason(now)) return "expired";
  if (running) return "busy";
  if (prefersReducedMotion() || typeof lane.animate !== "function") return "static";

  const ghost = ghostSvg("spooky-ghost");
  lane.append(ghost);
  const distance = Math.max(0, lane.clientWidth - 24);
  const animation = ghost.animate(
    [
      { transform: `translate(${distance}px, 2px)`, opacity: 0 },
      { transform: `translate(${distance * 0.75}px, -1px)`, opacity: 0.95, offset: 0.15 },
      { transform: `translate(${distance * 0.4}px, 3px)`, opacity: 0.95, offset: 0.55 },
      { transform: "translate(0px, 0px)", opacity: 0 },
    ],
    { duration: DURATION_MS, easing: "ease-in-out", fill: "none", iterations: 1 },
  );
  running = animation;
  const finish = () => {
    ghost.remove();
    running = null;
    onDone();
  };
  animation.addEventListener("finish", finish, { once: true });
  animation.addEventListener("cancel", finish, { once: true });
  return "animated";
}

export function isSpookyRunning(): boolean {
  return running !== null;
}
