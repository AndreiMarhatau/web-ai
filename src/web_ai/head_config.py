from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, List

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class HeadNode(BaseModel):
    id: str
    name: str
    url: HttpUrl


class HeadSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.head",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="allow",
    )

    app_host: str = Field(default="0.0.0.0", validation_alias="HEAD_HOST")
    app_port: int = Field(default=7790, validation_alias="HEAD_PORT")
    nodes_raw: str | list[str] | list[dict[str, str]] | None = Field(
        default=None,
        validation_alias="HEAD_NODES",
    )
    nodes: List[HeadNode] = Field(default_factory=list, exclude=True)

    key_dir: Path = Field(default=Path("./data/head"), validation_alias="HEAD_KEY_DIR")
    private_key_path: Path = Field(
        default=Path("./data/head/head_private.pem"),
        validation_alias="HEAD_PRIVATE_KEY_PATH",
    )
    public_key_path: Path = Field(
        default=Path("./data/head/head_public.pem"),
        validation_alias="HEAD_PUBLIC_KEY_PATH",
    )
    token_ttl_seconds: int = Field(default=120, validation_alias="HEAD_TOKEN_TTL")
    token_audience: str = Field(default="node", validation_alias="HEAD_TOKEN_AUDIENCE")
    enroll_token: str | None = Field(default=None, validation_alias="HEAD_ENROLL_TOKEN")

    @model_validator(mode="after")
    def _parse_nodes(self):
        value = self.nodes_raw
        if not value:
            self.nodes = []
            return self
        if isinstance(value, str):
            entries = [item.strip() for item in value.split(",") if item.strip()]
        else:
            entries = value

        parsed: list[HeadNode] = []
        for idx, entry in enumerate(entries, start=1):
            if isinstance(entry, dict):
                node_id = entry.get("id") or f"node-{idx}"
                name = entry.get("name") or node_id
                url = entry.get("url")
                parsed.append(HeadNode(id=node_id, name=name, url=url))
                continue

            if not isinstance(entry, str):
                raise ValueError("HEAD_NODES entries must be strings or dicts")
            parts = [part.strip() for part in entry.split("|") if part.strip()]
            if not parts:
                continue
            url = parts[0]
            name = parts[1] if len(parts) > 1 else f"node-{idx}"
            node_id = name if name else f"node-{idx}"
            parsed.append(HeadNode(id=node_id, name=name or node_id, url=url))

        self.nodes = parsed
        return self

    def ensure_paths(self) -> None:
        self.key_dir.mkdir(parents=True, exist_ok=True)
        def _normalize(path: Path) -> Path:
            if path.is_absolute():
                return path
            # If already under key_dir, keep as-is relative; otherwise place under key_dir
            path_parts = path.parts
            key_dir_parts = self.key_dir.resolve().parts
            if len(path_parts) >= len(key_dir_parts) and path_parts[: len(key_dir_parts)] == key_dir_parts:
                return path
            return (self.key_dir / path.name).resolve()

        self.private_key_path = _normalize(self.private_key_path)
        self.public_key_path = _normalize(self.public_key_path)


@lru_cache(maxsize=1)
def get_head_settings() -> HeadSettings:
    settings = HeadSettings()
    settings.ensure_paths()
    return settings


__all__ = ["HeadSettings", "HeadNode", "get_head_settings"]
