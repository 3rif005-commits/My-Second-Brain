// Commands with stable ids (ArtCraft study M1, after WordCraft's "everything is a command").
// A screen registers what it can do while it is mounted; quick find (⌘P) lists the matches,
// and anything else — a test, a plugin, the AI — can run one by id. A command never asks a
// question of its own: it does its one thing or nothing.

export interface Command {
  /** Stable, dotted: "note.present". Never renamed once shipped. */
  id: string;
  label: string;
  /** Extra words quick find matches on. */
  keywords?: string[];
  run: () => void;
}

const registry = new Map<string, Command>();

/** Register commands; returns the function that removes exactly these again. */
export function registerCommands(commands: Command[]): () => void {
  for (const c of commands) registry.set(c.id, c);
  return () => {
    for (const c of commands) if (registry.get(c.id) === c) registry.delete(c.id);
  };
}

/** Run a command by id; false when none is registered (the screen isn't open). */
export function runCommand(id: string): boolean {
  const c = registry.get(id);
  if (!c) return false;
  c.run();
  return true;
}

/** Commands matching a quick-find query: every word must start a word of the label or a
 *  keyword. ">" alone lists them all; an empty query lists none (that view shows recents). */
export function findCommands(query: string): Command[] {
  const q = query.trim().toLowerCase().replace(/^>\s*/, "");
  if (!query.trim()) return [];
  const all = [...registry.values()];
  if (!q) return all;
  const words = q.split(/\s+/);
  return all.filter((c) => {
    const hay = [c.label, ...(c.keywords ?? [])].join(" ").toLowerCase().split(/[^a-z0-9]+/);
    return words.every((w) => hay.some((h) => h.startsWith(w)));
  });
}
