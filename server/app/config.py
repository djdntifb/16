from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql://halifax:halifax_dev@localhost:5432/halifax_time"
    secret_key: str = "dev-secret-key-change-in-production"
    access_token_expire_minutes: int = 480
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()

import os as _os
if settings.secret_key == "dev-secret-key-change-in-production" and not _os.getenv("ALLOW_DEV_SECRET"):
    raise RuntimeError(
        "SECRET_KEY is still the dev default. "
        "Set a random SECRET_KEY in your .env, "
        "or set ALLOW_DEV_SECRET=1 for local dev."
    )
