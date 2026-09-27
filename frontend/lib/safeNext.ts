/** Where to go after signing in: a path on THIS app only (e.g. the Allow
 *  page of an app connecting to Second Brain), never another site. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/brain";
  return next;
}
