// Present a note as slides (ArtCraft study item 10, after deckcraft's slide show): each h1/h2
// starts a slide, and the show's keys — no buttons to learn, nothing to set up.

export interface PresentState {
  index: number;
  count: number;
  grid: boolean;
  black: boolean;
  /** Digits typed so far for "go to slide N", shown until Enter or 3 s pass. */
  typed: string;
}

export const initialPresent = (count: number): PresentState =>
  ({ index: 0, count: Math.max(1, count), grid: false, black: false, typed: "" });

/** Group top-level blocks into slides: a new slide at every heading of level 1 or 2. */
export function groupSlides(levels: (number | null)[]): number[][] {
  const slides: number[][] = [];
  levels.forEach((lvl, i) => {
    if ((lvl === 1 || lvl === 2) || !slides.length) slides.push([i]);
    else slides[slides.length - 1].push(i);
  });
  return slides;
}

const clamp = (s: PresentState, i: number) => ({ ...s, index: Math.min(s.count - 1, Math.max(0, i)), typed: "" });

/** The show's keyboard. Returns the next state, or "exit" to leave. */
export function presentKey(s: PresentState, key: string): PresentState | "exit" {
  if (/^[0-9]$/.test(key)) return { ...s, typed: (s.typed + key).slice(0, 4) };
  if (key === "Enter" && s.typed) return clamp({ ...s, grid: false }, Number(s.typed) - 1);
  switch (key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Enter": case "n":
      return clamp(s, s.index + 1);
    case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": case "p":
      return clamp(s, s.index - 1);
    case "Home": return clamp(s, 0);
    case "End": return clamp(s, s.count - 1);
    case "g": case "G": return { ...s, grid: !s.grid, typed: "" };
    case "b": case "B": case ".": return { ...s, black: !s.black, typed: "" };
    case "Escape":
      if (s.typed) return { ...s, typed: "" };
      if (s.grid) return { ...s, grid: false };
      if (s.black) return { ...s, black: false };
      return "exit";
    default: return s;
  }
}

/** Scale that makes content fit its box: never larger than 1, never below `floor`. */
export function fitScale(contentW: number, contentH: number, boxW: number, boxH: number, floor = 0.5): number {
  if (!(contentW > 0) || !(contentH > 0)) return 1;
  return Math.max(floor, Math.min(1, boxW / contentW, boxH / contentH));
}
