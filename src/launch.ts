// Launch animation: a short splash when the panel opens. Purely cosmetic and
// isolated from capture (which starts independently). It never blocks input:
// the overlay ignores the pointer, any key or click skips it, and it is not
// shown at all when the user prefers reduced motion. Through Nov 1, 2026 it
// adds cobwebs, two dangling spiders and pumpkins.
import { isHalloweenSeason } from "./season.js";

export type LaunchResult = "played" | "skipped-reduced-motion" | "unsupported";

const LOGO = `
<svg class="launch-logo" viewBox="0 0 64 64" aria-hidden="true">
  <circle class="ring" cx="27" cy="27" r="17" />
  <path class="handle" d="M39.5 39.5 54 54" />
  <path class="pulse" d="M15 28h6l3-8 5 15 4-11 2 4h5" />
</svg>`;

const WEB = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <g fill="none" stroke-width="1">
    <path d="M0 0 100 100M0 0 100 38M0 0 38 100M0 0 100 0M0 0 0 100M0 0 72 100M0 0 100 72" />
    <path d="M24 0Q20 9 0 24M46 0Q40 20 0 46M68 0Q60 32 0 68M90 0Q80 44 0 90" />
  </g>
</svg>`;

const SPIDER = `
<svg viewBox="0 0 40 120" aria-hidden="true">
  <path class="thread" d="M20 0V92" />
  <g class="spider-body" transform="translate(20 100)">
    <path class="legs" d="M-4-2-13-9-17-3M-4 0-15-2-19 4M-4 2-13 6-15 12M-3 4-9 11-9 17M4-2 13-9 17-3M4 0 15-2 19 4M4 2 13 6 15 12M3 4 9 11 9 17" />
    <ellipse rx="6" ry="7.5" cy="2" />
    <circle r="4.5" cy="-7" />
    <circle class="eye" r="1" cx="-1.6" cy="-8" /><circle class="eye" r="1" cx="1.6" cy="-8" />
  </g>
</svg>`;

const PUMPKIN = `
<svg viewBox="0 0 60 54" aria-hidden="true">
  <path class="stem" d="M30 12c0-5 1-8 5-10" />
  <ellipse class="p-side" cx="18" cy="32" rx="14" ry="19" />
  <ellipse class="p-side" cx="42" cy="32" rx="14" ry="19" />
  <ellipse class="p-mid" cx="30" cy="32" rx="13" ry="20" />
  <path class="face" d="M20 28l5-5 4 5ZM31 28l5-5 4 5ZM19 38q11 9 22 0l-4 1-3-2-4 3-4-3-3 2Z" />
</svg>`;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Build the overlay markup. Static strings only; no captured data is ever inserted. */
function buildOverlay(halloween: boolean): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "launch" + (halloween ? " launch-halloween" : "");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="launch-center">
      ${LOGO}
      <div class="launch-title">Quick Debug</div>
      <div class="launch-sub">${halloween ? "Network requests, explained · Happy Halloween" : "Network requests, explained"}</div>
    </div>
    ${
      halloween
        ? `<div class="web web-tl">${WEB}</div><div class="web web-tr">${WEB}</div>
           <div class="web web-bl">${WEB}</div><div class="web web-br">${WEB}</div>
           <div class="spider spider-1">${SPIDER}</div><div class="spider spider-2">${SPIDER}</div>
           <div class="pumpkins"><div class="pumpkin p1">${PUMPKIN}</div><div class="pumpkin p2">${PUMPKIN}</div><div class="pumpkin p3">${PUMPKIN}</div></div>`
        : ""
    }`;
  return overlay;
}

/**
 * Play the launch animation over `root`. Resolves when the overlay is gone.
 * `now` is injectable so the seasonal variant can be tested.
 */
export function playLaunch(root: HTMLElement, now: Date = new Date()): { result: LaunchResult; done: Promise<void> } {
  if (prefersReducedMotion()) return { result: "skipped-reduced-motion", done: Promise.resolve() };
  if (typeof root.animate !== "function") return { result: "unsupported", done: Promise.resolve() };

  const halloween = isHalloweenSeason(now);
  const overlay = buildOverlay(halloween);
  root.append(overlay);
  const total = halloween ? 2100 : 1400;
  const q = <T extends Element>(sel: string) => [...overlay.querySelectorAll<T>(sel)];
  const anims: Animation[] = [];
  const add = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => anims.push(el.animate(frames, { fill: "both", ...opts }));

  // Logo: the ring and pulse draw themselves, then the title rises in.
  for (const path of q<SVGGeometryElement>(".launch-logo .ring, .launch-logo .handle, .launch-logo .pulse")) {
    const len = path.getTotalLength?.() || 120;
    path.style.strokeDasharray = String(len);
    add(path, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 650, delay: 80, easing: "cubic-bezier(.4,0,.2,1)" });
  }
  add(overlay.querySelector(".launch-logo")!, [{ transform: "scale(.86)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 420, easing: "ease-out" });
  for (const [i, el] of q(".launch-title, .launch-sub").entries())
    add(el, [{ transform: "translateY(6px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, delay: 300 + i * 120, easing: "ease-out" });

  if (halloween) {
    for (const [i, web] of q(".web").entries())
      add(web, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: 500, delay: i * 70, easing: "ease-out" });
    for (const [i, spider] of q(".spider").entries())
      add(spider, [
        { transform: "translateY(-120%)" },
        { transform: "translateY(4%)", offset: 0.55 },
        { transform: "translateY(-6%)", offset: 0.75 },
        { transform: "translateY(0)" },
      ], { duration: 1100, delay: 250 + i * 220, easing: "ease-in-out" });
    for (const [i, p] of q(".pumpkin").entries())
      add(p, [
        { transform: "translateY(120%) rotate(0deg)", opacity: 0 },
        { transform: "translateY(-6%) rotate(-4deg)", opacity: 1, offset: 0.6 },
        { transform: "translateY(0) rotate(2deg)", opacity: 1, offset: 0.8 },
        { transform: "translateY(0) rotate(0deg)", opacity: 1 },
      ], { duration: 800, delay: 450 + i * 120, easing: "ease-out" });
  }

  // Fade the whole overlay out at the end.
  const fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, delay: total - 350, fill: "forwards", easing: "ease-in" });
  anims.push(fade);

  // Any key or click skips straight to the end; the overlay never blocks the UI either way.
  const skip = () => anims.forEach((a) => a.finish());
  document.addEventListener("keydown", skip, { capture: true, once: true });
  document.addEventListener("pointerdown", skip, { capture: true, once: true });

  const done = fade.finished
    .catch(() => undefined)
    .then(() => {
      document.removeEventListener("keydown", skip, { capture: true });
      document.removeEventListener("pointerdown", skip, { capture: true });
      for (const a of anims) a.cancel();
      overlay.remove();
    });
  return { result: "played", done };
}
