# Web research with Tavily: the hackathon add-on

Built for the Nebius x NVIDIA Global AI Hackathon (Tavily bonus prize). The chat model gets one
extra tool, `web.search_web`. It searches the public web through Tavily and answers with links.

**It is an add-on and can be removed.** With `TAVILY_API_KEY` unset, the tool is not offered.
Every line it adds outside its own files is marked `HACKATHON-TAVILY`:

```
grep -rn HACKATHON-TAVILY --include=*.py --include=*.tsx --include=*.yaml --include=*.example .
```

## How it keeps your notes in

- **Only the search words go to Tavily.** No note text, no chat history, no account details.
- **The model writes those words.** So once a chat has read your notes or private data, the app
  asks first. It shows the exact words: *Search the web for "…"? Only these words are sent to
  Tavily.* One Confirm covers the web searches for that answer.
- **Web pages are untrusted text.** They are cleaned (hidden characters removed, tags defused) and
  mark the rest of the turn as untrusted. After a web search, changing an existing note or
  calling an MCP server needs your OK.
- Only `http(s)` links are kept. Each page is cut to about 1,200 characters.

## Settings (Render → Environment)

| Name | Meaning |
|---|---|
| `TAVILY_API_KEY` | key from https://app.tavily.com. Unset = off. Free plan: 1,000 searches a month |

## How to remove it

1. Delete `backend/services/web_research.py`, `backend/tests/test_web_research.py` and this file.
2. Remove each `HACKATHON-TAVILY` touchpoint (the grep above lists them):

   | File | Remove |
   |---|---|
   | `backend/core/config.py` | the `tavily_api_key` block |
   | `backend/services/agent/permissions.py` | `_LEAVES_THE_APP`, its `_TOOL_MIN_TIER` entry, and the "Search the web" check in `check()` |
   | `backend/services/agent/engine.py` | the import, the tool-list lines, the `elif` branch in the tool loop, and the summary lines |
   | `frontend/components/ai/ToolEvent.tsx` | the `web.search_web` icon |
   | `render.yaml`, `backend/.env.example` | the `TAVILY_API_KEY` entries |

3. Run the backend tests, then delete `TAVILY_API_KEY` on Render.

Nothing was added to the database.
