import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    supabase_url: str
    supabase_service_role_key: str
    # No longer read anywhere (routers/notes.py's get_user_id now verifies
    # remotely via Supabase's auth API instead of decoding the JWT locally
    # — see that function's docstring). Kept here, not removed: .env still
    # sets SUPABASE_JWT_SECRET and this app's Settings is extra="forbid",
    # so dropping the field breaks config loading unless .env is edited
    # too. Harmless to keep; safe to delete whenever .env is next touched.
    supabase_jwt_secret: str
    google_api_key: str = ""
    openrouter_api_key: str = ""
    llm_provider: str = "openrouter"          # "openrouter" | "llamacpp" | "gemini"
    llamacpp_base_url: str = "http://localhost:8080"   # llama.cpp generation server
    llamacpp_model: str = "gemma-4-e2b"                # model name sent in requests
    embedder_provider: str = "llamacpp"  # "llamacpp" | "gemini"
    llamacpp_embed_url: str = "http://localhost:8081"  # llama.cpp embedding server
    litert_url: str = ""                               # tablet LiteRT inference server
    # MCP server ↔ FastAPI auth. No usable default on purpose: an unset or
    # example key works only from this machine (routers/internal.py).
    internal_api_key: str = ""
    frontend_url: str = "http://localhost:3000"
    database_url: str = ""
    # MCP "stdio" servers run a command on THIS machine. Fine on your own laptop; on a
    # shared server it would let any signed-in user run any command there. Off by
    # default where Render runs us (Render sets RENDER on every service).
    mcp_allow_stdio: bool = not os.getenv("RENDER")
    # Outbound requests to a URL a user typed (website import, MCP servers, custom AI
    # providers, webhooks) may reach private/loopback/link-local addresses only when
    # this is on — your own machine, where "private" is your LAN or localhost. Off
    # where Render runs us, so nobody can make the server call its own network
    # (services/egress.py).
    egress_allow_private: bool = not os.getenv("RENDER")
    # Gates the notes-row exclusion sweep and the database query engine.
    # Default False: migration 014 (db_row_props) does not exist yet, so an
    # unconditional exclusion clause would break every notes surface today.
    # Milestone 2 flips this to True once the migration is applied.
    database_rows_enabled: bool = False

    # Encryption key(s) for secrets at rest (services/secrets.py). Comma-separated
    # Fernet keys; the first encrypts. Empty = secrets cannot be stored (fail closed).
    secrets_key: str = ""
    # Local backup archive (.sbz). Off until you turn it on: it contains your private notes.
    backup_enabled: bool = False
    backup_dir: str = ""
    # Notion sync tests only: a token for a THROWAWAY workspace whose root page is
    # named SB-TEST-… (docs/notion-sync/ROBUSTNESS.md §6). Never your real workspace.
    notion_test_token: str = ""

    # AI substrate — Phase 1
    api_provider: str = "openrouter"        # "openrouter" | "anthropic" | "openai"
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    default_mode: str = "api"               # default model mode for new threads

    api_model_openrouter: str = "nvidia/nemotron-3-super-120b-a12b:free"
    api_model_anthropic: str = "claude-haiku-4-5"
    api_model_openai: str = "gpt-4o-mini"

    # Send the source's figure crops to the model alongside the text during
    # workspace synthesis (services/workspace/figures.py).
    # Default False on evidence, not on caution: measured over 5 runs each on
    # the reference lecture, attaching figures produced no content the text-only
    # runs missed, and dropped colour-budget compliance from 10/10 runs to 4/5 —
    # the deck has exactly one informative diagram after deduplication, and its
    # content is already in the text. Worth turning on for genuinely
    # diagram-heavy sources; re-measure before making it the default.
    workspace_synthesis_vision: bool = False

    # What happens when the last dropped source finishes processing.
    #   "suggest" (default) — extract, chunk and embed only; the UI offers a
    #                         priced "Generate" action and the user decides.
    #   "auto"              — the old behaviour: fire one synthesis unasked.
    #   "nothing"           — no synthesis trigger and no suggestion.
    # Default is "suggest" because the auto path spent up to ~45K tokens on a
    # drop the user may only have wanted indexed, and re-synthesis paid it
    # again. The manual POST /notes/{id}/synthesize path is unaffected by this
    # setting — it is an explicit request.
    workspace_on_drop: str = "suggest"
    # Study-guide output format. "html" is the shipped dialect. "md" writes
    # Markdown and converts it with services/workspace/md_to_blocks: at depth
    # parity and -41% cost on long AI-generated study guides (E6b), but on real
    # lecture SLIDES it lost more than half the tables (1/3 vs 3/3, E6c) — so
    # it is opt-in (SYNTHESIS_FORMAT=md). Figure and video runs always use html.
    synthesis_format: str = "html"
    # E3: send the study-guide instructions as a cached prefix (Anthropic
    # cache_control). A guide started within 5 minutes of another costs −8.6%,
    # a lone one +2.4%; quality guard held (docs/superpowers/experiments/
    # E3-prompt-cache.md). SYNTHESIS_PROMPT_CACHE=false to turn off.
    synthesis_prompt_cache: bool = True
    # E3b: cache marks on agent (chat / workspace AI) requests — Anthropic, and
    # Anthropic/Gemini models via OpenRouter. The request is ordered for
    # caching on every provider regardless; this only adds the marks. Sonnet 5:
    # 64% of a 4-message chat read from cache, −43%; below a model's minimum a
    # mark costs nothing (docs/superpowers/experiments/E3b-chat-prompt-cache.md).
    agent_prompt_cache: bool = True
    # E8: how often the backend indexes notes whose content changed (any
    # writer — editor, AI, import, Android). 0 turns it off. Needs migration 021.
    index_sweep_seconds: int = 60
    # E9: a study guide from at least this many sources is planned, then
    # written chapter by chapter (3 lectures: each 132-206% of its solo depth
    # vs 55-106% in one call, about 2x the cost). 0 = always one call.
    synthesis_chapters_min_sources: int = 3

    # Spending ceiling for one piece of work: one synthesis, or one agent turn
    # including all of its tool rounds. A run that would exceed it is refused
    # with the estimate in the message rather than attempted. 0 disables the
    # check. The reference lecture synthesis costs ~$0.03, so the default
    # leaves plenty of room while still catching a runaway.
    max_usd_per_run: float = 0.50

    # ── A custom OpenAI-compatible provider ──────────────────────────────
    # Any platform that speaks /v1/chat/completions: DeepSeek, Groq, Together,
    # a self-hosted gateway. Set the four CUSTOM_LLM_* values and it joins the
    # provider chain ahead of the other .env providers (behind Anthropic, which
    # the note prompts are tuned for — unless Anthropic is disabled below).
    custom_llm_base_url: str = ""      # e.g. https://api.deepseek.com
    custom_llm_api_key: str = ""
    custom_llm_model: str = ""         # e.g. deepseek-flash
    custom_llm_label: str = ""         # shown in the run log and eval reports
    # USD per 1M tokens. Leave empty when unknown: the run log then reports no
    # dollar figure rather than pretending a call was free. Set 0 for a genuinely
    # free tier.
    custom_llm_price_in: float | None = None
    custom_llm_price_out: float | None = None

    # ── HACKATHON-NEBIUS: Nemotron on Nebius (services/nebius.py) ─────────
    # Unset NEBIUS_API_KEY and none of this runs. Removal: docs/hackathon/NEBIUS.md
    nebius_api_key: str = ""                           # Token Factory key
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1"
    nebius_fast_model: str = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
    nebius_strong_model: str = "nvidia/nemotron-3-super-120b-a12b"
    nebius_price_in: float | None = None               # USD per 1M tokens; unset = unknown
    nebius_price_out: float | None = None
    nebius_vm_url: str = ""          # the front-door Nemotron on your Nebius VM (https)
    nebius_vm_api_key: str = ""      # the key the VM's server was started with
    nebius_vm_model: str = "nvidia/NVIDIA-Nemotron-Nano-9B-v2"

    # ── HACKATHON-TAVILY: web research in chat (services/web_research.py) ──
    # Unset = the tool is not offered. Removal: docs/hackathon/TAVILY.md
    tavily_api_key: str = ""

    # How skill instructions reach the agent's system prompt.
    #   "inline" (default) — the classifier's top matches are pasted in whole,
    #                        which is what shipped and what the numbers describe.
    #   "index"            — only name + description for every skill (~100
    #                        tokens each), and the model calls skill.load to
    #                        read one. Keeps the base prompt flat as the
    #                        catalogue grows, at the cost of a round trip.
    # Left on "inline" until E7 measures the trade on real agent cases.
    agent_skill_disclosure: str = "inline"

    # Providers to skip entirely, comma-separated ("anthropic,gemini").
    # A provider with no balance is not a fallback: it is a guaranteed failed
    # request on every single call, a wasted round trip, and an error row in
    # the run log. Disabling it is how you stop paying for that.
    ai_disabled_providers: str = ""

    # Inline editor AI uses forced tool-calling (xl-ai applyDocumentOperations).
    # Free models don't support tool_choice: required — use a model that does.
    # Override via INLINE_MODEL in .env.
    inline_model: str = "openai/gpt-4o-mini"


settings = Settings()  # type: ignore[call-arg]
