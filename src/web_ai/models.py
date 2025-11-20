from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional, Literal

from pydantic import BaseModel, Field, field_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TaskStatus(str, Enum):
    pending = "pending"
    scheduled = "scheduled"
    running = "running"
    waiting_for_input = "waiting_for_input"
    completed = "completed"
    failed = "failed"
    stopped = "stopped"
    cancelled = "cancelled"


class ChatRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class ChatMessage(BaseModel):
    role: ChatRole
    content: str
    created_at: datetime = Field(default_factory=utcnow)


class TaskStep(BaseModel):
    step_number: int
    summary_html: str
    created_at: datetime = Field(default_factory=utcnow)
    screenshot_b64: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
    raw_state: Optional[dict[str, Any]] = None
    raw_output: Optional[dict[str, Any]] = None


class AssistanceRequest(BaseModel):
    question: str
    requested_at: datetime = Field(default_factory=utcnow)
    responded_at: Optional[datetime] = None
    response_text: Optional[str] = None


class TaskRecord(BaseModel):
    id: str
    title: str
    instructions: str
    status: TaskStatus = TaskStatus.pending
    leave_browser_open: bool = False
    browser_open: bool = False
    keepalive_requested: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    scheduled_for: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    last_error: Optional[str] = None
    result_summary: Optional[str] = None
    model_name: str = "gpt-4o-mini"
    temperature: Optional[float] = None
    reasoning_effort: Optional[Literal["low", "medium", "high"]] = None
    max_steps: int = 80
    max_actions_per_step: int = 12
    max_input_tokens: int = 128_000
    use_vision: bool = True
    vnc_token: str
    browser_data_dir: str
    downloads_dir: str
    recordings_dir: Optional[str] = None
    traces_dir: Optional[str] = None
    step_count: int = 0
    needs_attention: bool = False
    assistance: Optional[AssistanceRequest] = None


class PersistedTask(BaseModel):
    record: TaskRecord
    steps: list[TaskStep]
    chat_history: list[ChatMessage]


class TaskCreatePayload(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    instructions: str = Field(..., min_length=5)
    model: str
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_steps: int = Field(default=80, ge=1, le=200)
    leave_browser_open: bool = False
    reasoning_effort: Optional[Literal["low", "medium", "high"]] = None
    scheduled_for: Optional[datetime] = None

    @field_validator("scheduled_for")
    @classmethod
    def _require_timezone(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            raise ValueError("scheduled_for must include timezone information.")
        return value


class TaskSummary(BaseModel):
    id: str
    title: str
    status: TaskStatus
    browser_open: bool
    leave_browser_open: bool
    needs_attention: bool
    created_at: datetime
    updated_at: datetime
    scheduled_for: Optional[datetime] = None
    step_count: int
    model_name: str


class TaskDetail(BaseModel):
    record: TaskRecord
    steps: list[TaskStep]
    chat_history: list[ChatMessage]
    vnc_launch_url: Optional[str] = None
