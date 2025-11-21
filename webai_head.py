from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

CURRENT_DIR = Path(__file__).resolve().parent
SRC_DIR = CURRENT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.append(str(SRC_DIR))

from web_ai.head_config import get_head_settings  # noqa: E402


def main() -> None:
    settings = get_head_settings()
    uvicorn.run(
        "web_ai.head_app:app",
        host=settings.app_host,
        port=settings.app_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
