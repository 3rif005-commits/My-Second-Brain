/** A compact "how long ago" for small metadata labels: "just now", "5m ago",
 *  "3h ago", "2d ago". Shared by the notifications list and the citation
 *  hover card, which both show it at ~11px beside a title — where the short
 *  form reads at a glance and a long one would crowd the title out. */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
