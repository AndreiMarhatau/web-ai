from __future__ import annotations

import asyncio
import secrets
from pathlib import Path


class VNCManager:
    """Manage task-specific VNC tokens backed by the token file websockify understands."""

    def __init__(self, token_file: Path, target_host: str, target_port: int):
        self.token_file = token_file
        self.target_host = target_host
        self.target_port = target_port
        self._lock = asyncio.Lock()
        self._task_tokens: dict[str, str] = {}
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        self.token_file.touch(exist_ok=True)

    async def register_existing(self, task_id: str, token: str) -> None:
        async with self._lock:
            self._task_tokens[task_id] = token
            self._write_file_unlocked()

    async def mint(self, task_id: str) -> str:
        async with self._lock:
            token = secrets.token_urlsafe(24)
            self._task_tokens[task_id] = token
            self._write_file_unlocked()
            return token

    async def revoke(self, task_id: str) -> None:
        async with self._lock:
            if task_id in self._task_tokens:
                self._task_tokens.pop(task_id)
                self._write_file_unlocked()

    def lookup(self, task_id: str) -> str | None:
        return self._task_tokens.get(task_id)

    def _write_file_unlocked(self) -> None:
        lines = [
            f"{token}: {self.target_host}:{self.target_port}"
            for token in self._task_tokens.values()
        ]
        with self.token_file.open("w", encoding="utf-8") as fp:
            fp.write("\n".join(lines))
