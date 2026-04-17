from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    google_api_key: str = ""
    openrouter_api_key: str = ""
    llm_provider: str = "openrouter"   # "openrouter" | "gemini"
    frontend_url: str = "http://localhost:3000"
    database_url: str


settings = Settings()  # type: ignore[call-arg]
