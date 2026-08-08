from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    google_api_key: str = ""
    openrouter_api_key: str = ""
    llm_provider: str = "openrouter"          # "openrouter" | "llamacpp" | "gemini"
    llamacpp_base_url: str = "http://localhost:8080"   # llama.cpp generation server
    llamacpp_model: str = "gemma-4-e2b"                # model name sent in requests
    embedder_provider: str = "llamacpp"  # "llamacpp" | "gemini"
    llamacpp_embed_url: str = "http://localhost:8081"  # llama.cpp embedding server
    litert_url: str = ""                               # tablet LiteRT inference server
    internal_api_key: str = "changeme-internal-key"   # MCP server ↔ FastAPI auth
    frontend_url: str = "http://localhost:3000"
    database_url: str = ""
    # Gates the notes-row exclusion sweep and the database query engine.
    # Default False: migration 014 (db_row_props) does not exist yet, so an
    # unconditional exclusion clause would break every notes surface today.
    # Milestone 2 flips this to True once the migration is applied.
    database_rows_enabled: bool = False

    # AI substrate — Phase 1
    api_provider: str = "openrouter"        # "openrouter" | "anthropic" | "openai"
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    default_mode: str = "api"               # default model mode for new threads

    api_model_openrouter: str = "nvidia/nemotron-3-super-120b-a12b:free"
    api_model_anthropic: str = "claude-sonnet-4-6"
    api_model_openai: str = "gpt-4o-mini"

    # Inline editor AI uses forced tool-calling (xl-ai applyDocumentOperations).
    # Free models don't support tool_choice: required — use a model that does.
    # Override via INLINE_MODEL in .env.
    inline_model: str = "openai/gpt-4o-mini"


settings = Settings()  # type: ignore[call-arg]
