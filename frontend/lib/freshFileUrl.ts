// Ledger B2: a capture inserted into a note carried a 24-hour signed link, so the picture broke the next
// day. The editor asks here for a fresh link to one of OUR stored files (the backend checks it is yours).
const OURS = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/workspace-resources\//;
const cache = new Map<string, Promise<string>>();

export function isOurStoredFile(url: string): boolean {
  return OURS.test(url);
}

/** The url to actually show: a fresh long-lived one for our stored files, the same url for anything else.
 *  Never throws and never blocks the picture: if the server cannot help, the old link is tried as it was. */
export function freshFileUrl(url: string): Promise<string> {
  if (!url || !isOurStoredFile(url)) return Promise.resolve(url);
  let p = cache.get(url);
  if (!p) {
    p = fetch("/api/ws/storage/fresh-url", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => (b && typeof b.url === "string" ? b.url : url))
      .catch(() => url);
    cache.set(url, p);
  }
  return p;
}

export function _clearFreshUrlCache() {
  cache.clear();
}
