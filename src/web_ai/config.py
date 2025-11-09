from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import AliasChoices, Field
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
    app_host: str = Field(default="0.0.0.0", validation_alias="WEB_AI_HOST")
    app_port: int = Field(default=7790, validation_alias="WEB_AI_PORT")
    app_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("WEB_AI_APP_URL", "APP_URL"),
    )
    frontend_refresh_seconds: int = Field(
        default=3, validation_alias="WEB_AI_FRONTEND_REFRESH_SECONDS"
    )

    @property
    def app_public_url(self) -> str:
        """Return the base URL clients should use to reach this app."""
        raw_url = self.app_url or f"http://localhost:{self.app_port}"
        return raw_url.rstrip("/")

    # OpenAI-only agent defaults
    openai_model: str = Field(
        default="gpt-5-mini",
        validation_alias=AliasChoices("WEB_AI_OPENAI_MODEL", "OPENAI_MODEL"),
    )
    openai_temperature: float | None = Field(
        default=None, validation_alias=AliasChoices("WEB_AI_OPENAI_TEMPERATURE", "OPENAI_TEMPERATURE")
    )
    max_steps: int = Field(
        default=80, validation_alias=AliasChoices("WEB_AI_MAX_STEPS", "MAX_STEPS")
    )
    max_actions_per_step: int = Field(default=12)
    max_input_tokens: int = Field(default=128_000)
    use_vision: bool = Field(default=True)

    openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("WEB_AI_OPENAI_API_KEY", "OPENAI_API_KEY"),
    )
    openai_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("WEB_AI_OPENAI_ENDPOINT", "OPENAI_ENDPOINT"),
    )

    # Browser + storage
    base_data_dir: Path = Field(
        default=Path("./data"),
        validation_alias=AliasChoices("WEB_AI_BASE_DATA_DIR", "BASE_DATA_DIR"),
    )
    tasks_dir_name: str = "tasks"
    browser_width: int = 1400
    browser_height: int = 1100
    headless: bool = False
    disable_security: bool = False
    deterministic_rendering: bool = False
    downloads_dir_name: str = "downloads"
    recordings_dir_name: str = "recordings"
    traces_dir_name: str = "traces"

    # VNC
    vnc_http_port: int = Field(
        default=6180, validation_alias=AliasChoices("WEB_AI_VNC_HTTP_PORT", "VNC_HTTP_PORT")
    )
    vnc_tcp_port: int = Field(
        default=5902, validation_alias=AliasChoices("WEB_AI_VNC_TCP_PORT", "VNC_TCP_PORT")
    )
    vnc_public_host: str = Field(
        default="localhost",
        validation_alias=AliasChoices("WEB_AI_VNC_PUBLIC_HOST", "VNC_PUBLIC_HOST"),
    )
    vnc_token_file: Optional[Path] = Field(
        default=None,
        validation_alias=AliasChoices("WEB_AI_VNC_TOKEN_FILE", "VNC_TOKEN_FILE"),
    )
    vnc_scheme: Literal["http", "https"] = "http"

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
