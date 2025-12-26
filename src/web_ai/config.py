from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the web-ai service."""

    model_config = SettingsConfigDict(
        env_file=".env.webai",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="allow",
    )

    # Application
    app_host: str = Field(default="0.0.0.0", validation_alias="APP_HOST")
    app_port: int = Field(default=7790, validation_alias="APP_PORT")
    frontend_refresh_seconds: int = Field(default=3, validation_alias="FRONTEND_REFRESH_SECONDS")

    # OpenAI-only agent defaults
    openai_model: str = Field(default="gpt-5-mini", validation_alias="OPENAI_MODEL")
    openai_temperature: float | None = None
    max_steps: int = 80
    max_actions_per_step: int = 12
    max_input_tokens: int = 128_000
    use_vision: bool = True

    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_base_url: str | None = Field(default=None, validation_alias="OPENAI_ENDPOINT")

    # Browser + storage
    base_data_dir: Path = Field(default=Path("./data"), validation_alias="BASE_DATA_DIR")
    tasks_dir_name: str = "tasks"
    browser_width: int = Field(default=1400)
    browser_height: int = Field(default=1100)
    headless: bool = Field(default=False, validation_alias="HEADLESS")
    disable_security: bool = False
    deterministic_rendering: bool = False
    downloads_dir_name: str = "downloads"
    recordings_dir_name: str = "recordings"
    traces_dir_name: str = "traces"
    schedule_check_interval_seconds: float = Field(default=1.5, validation_alias="SCHEDULE_CHECK_INTERVAL_SECONDS")

    # VNC
    vnc_http_port: int = Field(default=6180, validation_alias="VNC_HTTP_PORT")
    vnc_tcp_port: int = Field(default=5902, validation_alias="VNC_TCP_PORT")
    vnc_readonly_tcp_port: int = Field(
        default=5903, validation_alias="VNC_READONLY_TCP_PORT"
    )
    vnc_public_host: str = Field(default="localhost", validation_alias="VNC_PUBLIC_HOST")
    vnc_token_file: Optional[Path] = Field(default=None, validation_alias="VNC_TOKEN_FILE")
    vnc_scheme: Literal["http", "https"] = "http"

    # Node identity / auth
    node_id: str = Field(default="default", validation_alias="NODE_ID")
    node_name: str | None = Field(default=None, validation_alias="NODE_NAME")
    head_public_keys: str | list[str] | None = Field(
        default=None,
        validation_alias="HEAD_PUBLIC_KEYS",
    )
    head_auth_required: bool = Field(default=True, validation_alias="NODE_REQUIRE_AUTH")
    head_jwt_algorithm: str = Field(default="EdDSA", validation_alias="NODE_JWT_ALG")
    head_token_audience: str = Field(default="node", validation_alias="NODE_AUDIENCE")
    enroll_token: str | None = Field(default=None, validation_alias="NODE_ENROLL_TOKEN")

    @field_validator("head_public_keys", mode="before")
    @classmethod
    def _split_keys(cls, value):
        if not value:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _normalize_keys(self):
        # Ensure head_public_keys is always a list
        keys = self.head_public_keys
        if keys is None:
            self.head_public_keys = []
        elif isinstance(keys, str):
            self.head_public_keys = [k.strip() for k in keys.split(",") if k.strip()]
        return self

    def ensure_directories(self) -> None:
        """Create known directories up-front so later file writes never fail."""
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        if self.vnc_token_file is None:
            self.vnc_token_file = (self.base_data_dir / "vnc" / "tokens.txt")
        self.vnc_token_file = self.vnc_token_file.resolve()
        self.vnc_token_file.parent.mkdir(parents=True, exist_ok=True)
        self.vnc_token_file.touch(exist_ok=True)

    @property
    def tasks_dir(self) -> Path:
        return (self.base_data_dir / self.tasks_dir_name).resolve()

    @property
    def downloads_dir(self) -> Path:
        return (self.base_data_dir / self.downloads_dir_name).resolve()

    @property
    def recordings_dir(self) -> Path:
        return (self.base_data_dir / self.recordings_dir_name).resolve()

    @property
    def traces_dir(self) -> Path:
        return (self.base_data_dir / self.traces_dir_name).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    settings = Settings()
    settings.ensure_directories()
    return settings


__all__ = ["Settings", "get_settings"]
