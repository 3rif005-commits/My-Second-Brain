// Plugins shown in Settings → Plugins without pasting a link. Adding one here
// is the "approved" decision: it means someone read its code. Anything else
// can still be installed from a link, behind the warning.
export interface ApprovedPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  /** "owner/repo" — installs from the repo's latest GitHub release. */
  source: string;
}

export const APPROVED_PLUGINS: ApprovedPlugin[] = [
  {
    id: "webmcp",
    name: "WebMCP",
    description:
      "Exposes the open note or database as WebMCP tools for browser agents, with a panel to inspect and run them.",
    author: "Second Brain",
    source: "3rif005-commits/second-brain-webmcp",
  },
];
