from __future__ import annotations

import asyncio
import secrets
from pathlib import Path
from typing import Iterable


class VNCManager:
    """Manage task-specific VNC tokens backed by the token file websockify understands."""

    def __init__(self, token_file: Path, target_host: str, target_port: int):
        self.token_file = token_file
        self.target_host = target_host
        self.target_port = target_port
        self._lock = asyncio.Lock()
        self._token_map: dict[str, tuple[str, str, int]] = {}
        self._task_tokens: dict[str, set[str]] = {}
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        self.token_file.touch(exist_ok=True)

    async def register_existing(
        self,
        task_id: str,
        token: str,
        *,
        target_host: str | None = None,
        target_port: int | None = None,
    ) -> None:
        async with self._lock:
            host = target_host or self.target_host
            port = target_port or self.target_port
            self._token_map[token] = (task_id, host, port)
            self._task_tokens.setdefault(task_id, set()).add(token)
            await self._write_tokens()

    async def mint(
        self,
        task_id: str,
        *,
        target_host: str | None = None,
        target_port: int | None = None,
    ) -> str:
        async with self._lock:
            token = secrets.token_urlsafe(24)
            host = target_host or self.target_host
            port = target_port or self.target_port
            self._token_map[token] = (task_id, host, port)
            self._task_tokens.setdefault(task_id, set()).add(token)
            await self._write_tokens()
            return token

    async def revoke(self, task_id: str) -> None:
        async with self._lock:
            tokens = self._task_tokens.pop(task_id, set())
            if tokens:
                for token in tokens:
                    self._token_map.pop(token, None)
                await self._write_tokens()

    def lookup_task_id(self, token: str) -> str | None:
        entry = self._token_map.get(token)
        if not entry:
            return None
        return entry[0]

    def lookup(self, task_id: str) -> str | None:
        tokens = self._task_tokens.get(task_id)
        if not tokens:
            return None
        return next(iter(sorted(tokens)))

    async def _write_tokens(self) -> None:
        lines = self._render_lines(self._token_map.items())
        await asyncio.to_thread(self._write_file, lines)

    def _render_lines(
        self, tokens: Iterable[tuple[str, tuple[str, str, int]]]
    ) -> str:
        return "\n".join(
            f"{token}: {host}:{port}"
            for token, (_, host, port) in sorted(tokens)
        )

    def _write_file(self, content: str) -> None:
        with self.token_file.open("w", encoding="utf-8") as fp:
            fp.write(content)
