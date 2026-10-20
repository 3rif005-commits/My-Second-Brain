# second-brain-plugin-api

Types for writing [Second Brain](https://github.com/3rif005-commits/My-Second-Brain) plugins.
A plugin is two files, attached to a GitHub release (or served from any https folder):

- `manifest.json`: `{ "id": "my-plugin", "name": "My plugin", "version": "1.0.0", "minAppVersion": "0.1.0", "apiVersion": 1 }`
- `main.js`: an ES module whose default export has `onload(api)`

```ts
import type { Plugin } from "second-brain-plugin-api";

const plugin: Plugin = {
  onload(api) {
    api.workspace.onNoteOpen((note) => {
      console.log("opened", note.current().title);
      return () => console.log("closed");
    });
    api.ui.addPanel("hello", () => api.react.createElement("div", null, "Hello"));
  },
};
export default plugin;
```

Users install it in **Settings → Plugins**, with `owner/repo` or a folder link.

## Rules

- **Use the app's React** (`api.react`). Don't bundle React: mark `react` and
  `react/jsx-runtime` as external and map them to
  `window.__secondBrainPluginHost.React` / `.jsxRuntime` (see the WebMCP plugin's
  `esbuild.config.mjs` for a ready-made shim).
- Everything you register through `api` is removed when the plugin is turned off.
  `onunload()` is only for what you set up yourself.
- Plugins run with the user's access to their notes, so keep yours small and readable.

## Versioning

`apiVersion` changes only on breaking changes. This package's major version follows it.
The types are generated from `frontend/lib/plugins/api.ts` in the app repo (`npm run build`).
