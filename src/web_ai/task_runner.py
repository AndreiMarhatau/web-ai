from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any, Callable, Coroutine, Optional

# The upstream telemetry client uses dataclasses.asdict(), which currently crashes when
# complex controller/action schemas introduce circular references. Ensure telemetry stays
# disabled (unless explicitly enabled) and monkey-patch the capture hooks so we never
# invoke the problematic serialization.
if "ANONYMIZED_TELEMETRY" not in os.environ:
    os.environ["ANONYMIZED_TELEMETRY"] = "false"

try:  # pragma: no cover - plays defense against upstream telemetry bug
    from browser_use.telemetry.service import ProductTelemetry as _ProductTelemetry

    def _noop_capture(self, event):
        return None

    _ProductTelemetry.capture = _noop_capture
    _ProductTelemetry._direct_capture = _noop_capture
except Exception:
    pass

from browser_use.agent.views import AgentHistoryList, AgentOutput
from browser_use.browser.browser import BrowserConfig
from browser_use.browser.context import BrowserContextConfig
from browser_use.browser.views import BrowserState
from langchain_openai import ChatOpenAI

from web_ai.agent import BrowserUseAgent
from web_ai.browser import CustomBrowser, CustomBrowserContext
from web_ai.controller import CustomController

from .config import Settings, get_settings
from .models import (
    AssistanceRequest,
    ChatMessage,
    ChatRole,
    PersistedTask,
    TaskCreatePayload,
    TaskDetail,
    TaskRecord,
    TaskStatus,
    TaskStep,
    TaskSummary,
    utcnow,
)
from .storage import TaskStorage
from .vnc import VNCManager

logger = logging.getLogger(__name__)

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise ValueError("Timezone-aware datetime is required.")
    return value.astimezone(timezone.utc)


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    return _HTML_TAG_RE.sub("", value).strip()


def _serialize_browser_state(state: BrowserState | None) -> dict[str, Any] | None:
    if not state:
        return None
    tabs: list[dict[str, Any]] = []
    for tab in getattr(state, "tabs", []) or []:
        if hasattr(tab, "model_dump"):
            try:
                tabs.append(tab.model_dump(exclude_none=True))
                continue
            except Exception:
                pass
        tabs.append(
            {
                "page_id": getattr(tab, "page_id", None),
                "url": getattr(tab, "url", None),
                "title": getattr(tab, "title", None),
                "parent_page_id": getattr(tab, "parent_page_id", None),
            }
        )
    return {
        "url": getattr(state, "url", None),
        "title": getattr(state, "title", None),
        "tabs": tabs,
        "screenshot": getattr(state, "screenshot", None),
        "pixels_above": getattr(state, "pixels_above", None),
        "pixels_below": getattr(state, "pixels_below", None),
        "browser_errors": list(getattr(state, "browser_errors", []) or []),
    }


def _serialize_agent_output(output: AgentOutput | None) -> dict[str, Any] | None:
    if not output:
        return None
    try:
        current_state = output.current_state.model_dump(exclude_none=True)
    except Exception:
        current_state = str(output.current_state)
    actions: list[Any] = []
    for action in output.action or []:
        if hasattr(action, "model_dump"):
            try:
                actions.append(action.model_dump(exclude_none=True))
                continue
            except Exception:
                pass
        actions.append(str(action))
    return {"current_state": current_state, "action": actions}


def _safe_model_dump(value):
    if value is None:
        return None
    if isinstance(value, BrowserState):
        return _serialize_browser_state(value)
    if isinstance(value, AgentOutput):
        return _serialize_agent_output(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_safe_model_dump(v) for v in value]
    if isinstance(value, dict):
        return {k: _safe_model_dump(v) for k, v in value.items()}
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump(exclude_none=True)
        except Exception:
            pass
    if hasattr(value, "dict"):
        try:
            return {k: _safe_model_dump(v) for k, v in value.dict().items()}
        except Exception:
            pass
    data = getattr(value, "__dict__", None)
    if isinstance(data, dict):
        try:
            return {
                k: _safe_model_dump(v)
                for k, v in data.items()
                if not callable(v) and not k.startswith("_")
            }
        except Exception:
            pass
    return str(value)


def _format_agent_output(model_output: AgentOutput | None) -> str:
    if not model_output:
        return ""
    try:
        action_dump = [_safe_model_dump(action) for action in model_output.action or []]
        state_dump = _safe_model_dump(model_output.current_state)
        payload = {"current_state": state_dump, "action": action_dump}
        return f"<pre><code class='language-json'>{json.dumps(payload, indent=2)}</code></pre>"
    except Exception as exc:  # pragma: no cover - formatting fallback
        logger.debug("Could not format agent output: %s", exc)
        return f"<pre><code>{model_output}</code></pre>"


@dataclass
class TaskRuntime:
    data: PersistedTask
    controller: Optional[CustomController] = None
    browser: Optional[CustomBrowser] = None
    browser_context: Optional[CustomBrowserContext] = None
    agent: Optional[BrowserUseAgent] = None
    asyncio_task: Optional[asyncio.Task] = None
    assistance_event: Optional[asyncio.Event] = None
    pending_response: Optional[str] = None
    step_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def record(self) -> TaskRecord:
        return self.data.record


class TaskManager:
    """Coordinate BrowserUse agents, persistence, and UI state."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.storage = TaskStorage(self.settings.tasks_dir)
        self.vnc_manager = VNCManager(
            token_file=self.settings.vnc_token_file,
            target_host=self.settings.vnc_public_host,
            target_port=self.settings.vnc_tcp_port,
        )
        self._tasks: dict[str, TaskRuntime] = {}
        self._lock = asyncio.Lock()
        self._scheduler_task: Optional[asyncio.Task] = None

    async def startup(self) -> None:
        """Load persisted tasks and recreate VNC token file."""
        for persisted in await self.storage.load_all_async():
            runtime = TaskRuntime(data=persisted)
            self._tasks[persisted.record.id] = runtime
            if not persisted.record.node_id or persisted.record.node_id == "default":
                persisted.record.node_id = self.settings.node_id
                needs_save = True
            else:
                needs_save = False
            original_schedule = persisted.record.scheduled_for
            try:
                normalized = _normalize_datetime(persisted.record.scheduled_for)
                if normalized != original_schedule:
                    persisted.record.scheduled_for = normalized
                    needs_save = True
            except ValueError:
                logger.warning(
                    "Task %s has naive scheduled_for; clearing schedule on startup",
                    persisted.record.id,
                )
                persisted.record.scheduled_for = None
                needs_save = True
            # Tasks that were running before a restart are now stopped
            if persisted.record.browser_open:
                persisted.record.browser_open = False
                needs_save = True
            if persisted.record.status in {
                TaskStatus.running,
                TaskStatus.pending,
                TaskStatus.waiting_for_input,
            }:
                persisted.record.status = TaskStatus.stopped
                persisted.record.needs_attention = False
                needs_save = True
            if needs_save:
                persisted.record.updated_at = utcnow()
                await self.storage.save_async(persisted)
            if self._vnc_is_allowed(persisted.record):
                await self.vnc_manager.register_existing(
                    persisted.record.id, persisted.record.vnc_token
                )
        await self._start_due_scheduled_tasks()
        if not self._scheduler_task:
            self._scheduler_task = asyncio.create_task(self._scheduled_runner())

    def list_tasks(self) -> list[TaskSummary]:
        summaries: list[TaskSummary] = []
        for runtime in self._tasks.values():
            record = runtime.record
            browser_open = self._sync_browser_state(runtime)
            summaries.append(
                TaskSummary(
                    node_id=record.node_id,
                    id=record.id,
                    title=record.title,
                    status=record.status,
                    browser_open=browser_open,
                    leave_browser_open=record.leave_browser_open,
                    needs_attention=record.needs_attention,
                    created_at=record.created_at,
                    updated_at=record.updated_at,
                    scheduled_for=record.scheduled_for,
                    step_count=record.step_count,
                    model_name=record.model_name,
                )
            )
        summaries.sort(key=lambda item: item.created_at, reverse=True)
        return summaries

    def get_task(self, task_id: str) -> TaskRuntime | None:
        return self._tasks.get(task_id)

    def _is_browser_active(self, runtime: TaskRuntime) -> bool:
        return runtime.browser_context is not None

    def _sync_browser_state(self, runtime: TaskRuntime) -> bool:
        browser_open = self._is_browser_active(runtime)
        runtime.record.browser_open = browser_open
        return browser_open

    @staticmethod
    def _vnc_is_allowed(record: TaskRecord) -> bool:
        return (
            record.status == TaskStatus.waiting_for_input
            and record.needs_attention
        )

    def get_task_detail(self, task_id: str) -> TaskDetail | None:
        runtime = self._tasks.get(task_id)
        if not runtime:
            return None
        self._sync_browser_state(runtime)
        record = runtime.record
        vnc_url = None
        if self._vnc_is_allowed(record):
            vnc_url = f"/tasks/{record.id}/assist?token={record.vnc_token}"
        return TaskDetail(
            record=record,
            steps=runtime.data.steps,
            chat_history=runtime.data.chat_history,
            vnc_launch_url=vnc_url,
        )

    async def create_task(self, payload: TaskCreatePayload) -> TaskDetail:
        task_id = str(uuid.uuid4())
        token = secrets.token_urlsafe(24)
        task_dir = self.settings.tasks_dir / task_id
        browser_dir = task_dir / "browser-data"
        downloads_dir = task_dir / "downloads"
        recordings_dir = task_dir / "recordings"
        traces_dir = task_dir / "traces"
        await asyncio.to_thread(
            self._prepare_directories,
            (task_dir, browser_dir, downloads_dir, recordings_dir, traces_dir),
        )

        temperature = (
            payload.temperature
            if payload.temperature is not None
            else self.settings.openai_temperature
        )
        scheduled_for = _normalize_datetime(payload.scheduled_for)
        if scheduled_for and scheduled_for <= utcnow():
            raise ValueError("Scheduled start time must be in the future.")

        record = TaskRecord(
            node_id=self.settings.node_id,
            id=task_id,
            title=payload.title,
            instructions=payload.instructions,
            status=TaskStatus.scheduled if scheduled_for else TaskStatus.pending,
            leave_browser_open=payload.leave_browser_open,
            model_name=payload.model,
            temperature=temperature,
            reasoning_effort=payload.reasoning_effort,
            max_steps=payload.max_steps,
            max_actions_per_step=self.settings.max_actions_per_step,
            max_input_tokens=self.settings.max_input_tokens,
            use_vision=self.settings.use_vision,
            scheduled_for=scheduled_for,
            vnc_token=token,
            browser_data_dir=str(browser_dir),
            downloads_dir=str(downloads_dir),
            recordings_dir=str(recordings_dir),
            traces_dir=str(traces_dir),
        )

        persisted = PersistedTask(
            record=record,
            steps=[],
            chat_history=[
                ChatMessage(role=ChatRole.user, content=payload.instructions)
            ],
        )

        runtime = TaskRuntime(data=persisted)
        async with self._lock:
            self._tasks[task_id] = runtime
            await self.storage.save_async(persisted)
        if record.status == TaskStatus.scheduled:
            if not self._scheduler_task:
                self._scheduler_task = asyncio.create_task(self._scheduled_runner())
            return self.get_task_detail(task_id)

        await self._enqueue_run(runtime)
        return self.get_task_detail(task_id)

    async def _enqueue_run(self, runtime: TaskRuntime, *, clear_schedule: bool = False) -> None:
        """Dispatch a runtime to run on the agent loop."""
        if runtime.asyncio_task and not runtime.asyncio_task.done():
            raise RuntimeError("Task is already running.")
        async with self._lock:
            if self._tasks.get(runtime.record.id) is not runtime:
                return
        await self.vnc_manager.revoke(runtime.record.id)
        runtime.record.status = TaskStatus.pending
        if clear_schedule:
            runtime.record.scheduled_for = None
        runtime.record.updated_at = utcnow()
        await self.storage.save_async(runtime.data)
        runtime.asyncio_task = asyncio.create_task(self._run_task(runtime))

    async def _run_task(self, runtime: TaskRuntime) -> None:
        record = runtime.record
        record.status = TaskStatus.running
        record.browser_open = True
        record.updated_at = utcnow()
        await self.storage.save_async(runtime.data)
        logger.info("Starting task %s", record.id)

        try:
            runtime.controller = CustomController(
                ask_assistant_callback=lambda question, browser_ctx: self._handle_assistance_request(
                    runtime, question
                )
            )
            await runtime.controller.setup_mcp_client(None)

            runtime.browser = CustomBrowser(
                config=BrowserConfig(
                    headless=self.settings.headless,
                    disable_security=self.settings.disable_security,
                    deterministic_rendering=self.settings.deterministic_rendering,
                    new_context_config=BrowserContextConfig(
                        window_width=self.settings.browser_width,
                        window_height=self.settings.browser_height,
                    ),
                )
            )
            runtime.browser_context = await runtime.browser.new_context(
                config=BrowserContextConfig(
                    trace_path=record.traces_dir,
                    save_recording_path=record.recordings_dir,
                    save_downloads_path=record.downloads_dir,
                    window_width=self.settings.browser_width,
                    window_height=self.settings.browser_height,
                )
            )
            if runtime.data.steps:
                await self._restore_last_session(runtime)

            register_step = self._build_step_callback(runtime)
            register_done = self._build_done_callback(runtime)

            agent_task = self._compose_task_prompt(runtime)
            runtime.agent = BrowserUseAgent(
                task=agent_task,
                llm=self._build_llm(record),
                browser=runtime.browser,
                browser_context=runtime.browser_context,
                controller=runtime.controller,
                register_new_step_callback=register_step,
                register_done_callback=register_done,
                use_vision=record.use_vision,
                max_input_tokens=record.max_input_tokens,
                max_actions_per_step=record.max_actions_per_step,
                source="web-ai",
            )
            runtime.agent.state.agent_id = record.id

            agent_history = await runtime.agent.run(max_steps=record.max_steps)
            self._finalize_history(runtime, agent_history)

        except Exception as exc:
            logger.exception("Task %s failed", record.id)
            record.status = TaskStatus.failed
            record.last_error = str(exc)
            record.browser_open = False
        finally:
            keep_browser = record.leave_browser_open and record.status == TaskStatus.completed
            if not keep_browser:
                await self._close_browser(runtime)
            else:
                record.browser_open = True
            record.updated_at = utcnow()
            await self.storage.save_async(runtime.data)

    async def _start_due_scheduled_tasks(self) -> None:
        """Start any scheduled tasks whose start time has arrived."""
        now = utcnow()
        async with self._lock:
            snapshot = list(self._tasks.items())

        for task_id, runtime in snapshot:
            record = runtime.record
            if record.status != TaskStatus.scheduled:
                continue
            async with self._lock:
                current = self._tasks.get(task_id)
                if not current or current is not runtime:
                    continue
                try:
                    current_schedule = _normalize_datetime(current.record.scheduled_for)
                except ValueError:
                    logger.warning(
                        "Scheduled task %s has naive datetime; skipping until corrected",
                        task_id,
                    )
                    continue
                if not current_schedule or current_schedule > now:
                    continue
                current.record.scheduled_for = current_schedule
            if current is not runtime:
                continue
            await self._enqueue_run(runtime, clear_schedule=True)

    async def continue_task(self, task_id: str, instructions: str) -> TaskDetail | None:
        runtime = self.get_task(task_id)
        if not runtime:
            return None
        if runtime.record.status == TaskStatus.scheduled:
            raise RuntimeError("Task is scheduled and has not started yet.")
        if runtime.asyncio_task and not runtime.asyncio_task.done():
            raise RuntimeError("Task is already running.")
        additional = instructions.strip()
        if not additional:
            raise ValueError("Additional instructions are required to continue.")

        record = runtime.record
        await self.vnc_manager.revoke(record.id)
        record.status = TaskStatus.pending
        record.browser_open = False
        record.last_error = None
        record.result_summary = None
        record.completed_at = None
        record.needs_attention = False
        record.assistance = None
        record.updated_at = utcnow()
        runtime.data.chat_history.append(
            ChatMessage(role=ChatRole.user, content=additional)
        )
        await self.storage.save_async(runtime.data)

        # Close any existing browser session from the prior run so we don't leak
        # processes or leave a stale VNC instance running in the background.
        await self._close_browser(runtime)

        runtime.asyncio_task = asyncio.create_task(self._run_task(runtime))
        return self.get_task_detail(task_id)

    async def run_scheduled_now(self, task_id: str) -> TaskDetail | None:
        runtime = self.get_task(task_id)
        if not runtime or runtime.record.status != TaskStatus.scheduled:
            return None
        try:
            await self._enqueue_run(runtime, clear_schedule=True)
        except RuntimeError:
            return None
        return self.get_task_detail(task_id)

    async def reschedule_task(self, task_id: str, scheduled_for: datetime) -> TaskDetail | None:
        runtime = self.get_task(task_id)
        if not runtime or runtime.record.status != TaskStatus.scheduled:
            return None
        normalized = _normalize_datetime(scheduled_for)
        if not normalized or normalized <= utcnow():
            raise ValueError("Scheduled time must be in the future.")
        runtime.record.scheduled_for = normalized
        runtime.record.updated_at = utcnow()
        await self.storage.save_async(runtime.data)
        return self.get_task_detail(task_id)

    def _build_llm(self, record: TaskRecord) -> ChatOpenAI:
        if not self.settings.openai_api_key:
            raise RuntimeError(
                "OPENAI_API_KEY (or WEB_AI_OPENAI_API_KEY) is required to run tasks."
            )

        client_kwargs: dict[str, Any] = {
            "model": record.model_name,
            "api_key": self.settings.openai_api_key,
        }
        if record.temperature is not None:
            client_kwargs["temperature"] = record.temperature
        if self.settings.openai_base_url:
            client_kwargs["base_url"] = self.settings.openai_base_url

        model_kwargs: dict[str, Any] = {}
        if record.reasoning_effort:
            model_kwargs["reasoning"] = {"effort": record.reasoning_effort}
        if model_kwargs:
            client_kwargs["model_kwargs"] = model_kwargs

        return ChatOpenAI(**client_kwargs)

    def _compose_task_prompt(self, runtime: TaskRuntime) -> str:
        chat_history = runtime.data.chat_history
        initial_goal = (
            chat_history[0].content if chat_history else runtime.record.instructions
        )
        followups = [
            msg.content
            for msg in chat_history[1:]
            if msg.role == ChatRole.user and msg.content.strip()
        ]
        latest_followup = followups[-1] if followups else ""
        previous_followups = followups[:-1][-4:]

        sections: list[str] = []
        if initial_goal:
            sections.append("Primary goal:\n" + initial_goal.strip())
        if previous_followups:
            bullets = "\n".join(f"- {text}" for text in previous_followups)
            sections.append("Earlier follow-up requests:\n" + bullets)
        if latest_followup:
            sections.append("Current follow-up request:\n" + latest_followup.strip())

        step_summaries: list[str] = []
        for step in runtime.data.steps[-5:]:
            summary = _strip_html(step.summary_html)
            if not summary and step.title:
                summary = step.title
            if not summary and step.url:
                summary = f"Visited {step.url}"
            summary = summary or "No summary provided."
            step_summaries.append(f"Step {step.step_number}: {summary}")
        if step_summaries:
            sections.append(
                "Completed steps so far:\n" + "\n".join(step_summaries)
            )

        sections.append(
            "Continue from the existing browser session. Build on the completed work instead of starting over."
        )
        return "\n\n".join(section for section in sections if section.strip())

    async def _restore_last_session(self, runtime: TaskRuntime) -> None:
        """Best-effort attempt to reopen the last visited URL for a continued task."""
        if not runtime.browser_context:
            return
        if not runtime.data.steps:
            return
        last_url = runtime.data.steps[-1].url
        if not last_url:
            return
        try:
            page = await runtime.browser_context.get_agent_current_page()
            await page.goto(last_url)
            await page.wait_for_load_state()
        except Exception:
            logger.debug("Failed to restore last URL %s", last_url, exc_info=True)

    def _build_step_callback(
        self, runtime: TaskRuntime
    ) -> Callable[[BrowserState, AgentOutput, int], Coroutine[Any, Any, None]]:
        async def _on_step(state: BrowserState, output: AgentOutput, step_num: int) -> None:
            async with runtime.step_lock:
                summary = _format_agent_output(output)
                actual_step_number = runtime.record.step_count + 1
                runtime.data.steps.append(
                    TaskStep(
                        step_number=actual_step_number,
                        summary_html=summary,
                        screenshot_b64=getattr(state, "screenshot", None),
                        url=getattr(state, "url", None),
                        title=getattr(state, "title", None),
                        raw_state=_safe_model_dump(state),
                        raw_output=_safe_model_dump(output),
                    )
                )
                runtime.data.chat_history.append(
                    ChatMessage(
                        role=ChatRole.assistant,
                        content=f"Step {actual_step_number} completed.",
                    )
                )
                runtime.record.step_count = actual_step_number
                runtime.record.status = (
                    TaskStatus.waiting_for_input
                    if runtime.record.needs_attention
                    else TaskStatus.running
                )
                runtime.record.updated_at = utcnow()
                await self.storage.save_async(runtime.data)

        return _on_step

    def _build_done_callback(
        self, runtime: TaskRuntime
    ) -> Callable[[AgentHistoryList], None]:
        def _on_done(history: AgentHistoryList) -> None:
            result = history.final_result()
            duration = getattr(history, "total_duration_seconds", lambda: None)()
            message_lines = ["Task completed."]
            if duration:
                message_lines.append(f"Duration: {duration:.2f}s")
            if result:
                message_lines.append(f"Final result: {result}")
            runtime.data.chat_history.append(
                ChatMessage(role=ChatRole.assistant, content="\n".join(message_lines))
            )

        return _on_done

    def _finalize_history(self, runtime: TaskRuntime, history: AgentHistoryList) -> None:
        record = runtime.record
        record.completed_at = utcnow()
        errors = history.errors() if hasattr(history, "errors") else None
        if errors:
            record.last_error = "\n".join([err for err in errors if err])
        record.result_summary = history.final_result() if hasattr(history, "final_result") else None
        record.status = (
            TaskStatus.completed if not record.last_error else TaskStatus.failed
        )
        record.needs_attention = False
        record.updated_at = utcnow()
        runtime.data.chat_history.append(
            ChatMessage(
                role=ChatRole.system,
                content=f"Task finished with status {record.status.value}.",
            )
        )

    async def _handle_assistance_request(
        self, runtime: TaskRuntime, question: str
    ) -> dict[str, str]:
        runtime.assistance_event = asyncio.Event()
        runtime.pending_response = None
        runtime.record.needs_attention = True
        runtime.record.status = TaskStatus.waiting_for_input
        runtime.record.assistance = AssistanceRequest(question=question)
        runtime.record.vnc_token = await self.vnc_manager.mint(runtime.record.id)
        runtime.record.updated_at = utcnow()
        runtime.data.chat_history.append(
            ChatMessage(
                role=ChatRole.assistant,
                content=f"Agent needs help:\n{question}",
            )
        )
        await self.storage.save_async(runtime.data)
        try:
            await asyncio.wait_for(runtime.assistance_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            runtime.record.needs_attention = False
            runtime.record.status = TaskStatus.running
            runtime.record.assistance.response_text = "Timed out waiting for user input."
            runtime.record.assistance.responded_at = utcnow()
            await self.vnc_manager.revoke(runtime.record.id)
            await self.storage.save_async(runtime.data)
            return {"response": "Timeout waiting for user response."}

        response = runtime.pending_response or ""
        runtime.record.needs_attention = False
        runtime.record.status = TaskStatus.running
        runtime.record.assistance.response_text = response
        runtime.record.assistance.responded_at = utcnow()
        await self.vnc_manager.revoke(runtime.record.id)
        runtime.data.chat_history.append(
            ChatMessage(role=ChatRole.user, content=response)
        )
        await self.storage.save_async(runtime.data)
        runtime.assistance_event = None
        runtime.pending_response = None
        return {"response": response}

    async def submit_assistance(self, task_id: str, message: str) -> TaskDetail | None:
        runtime = self.get_task(task_id)
        if not runtime or not runtime.assistance_event:
            return None
        runtime.pending_response = message
        runtime.record.needs_attention = False
        runtime.record.status = TaskStatus.running
        runtime.record.updated_at = utcnow()
        await self.storage.save_async(runtime.data)
        runtime.assistance_event.set()
        await self.vnc_manager.revoke(task_id)
        return self.get_task_detail(task_id)

    async def close_browser(self, task_id: str) -> TaskDetail | None:
        runtime = self.get_task(task_id)
        if not runtime:
            return None
        await self._close_browser(runtime)
        runtime.record.leave_browser_open = False
        runtime.record.updated_at = utcnow()
        await self.storage.save_async(runtime.data)
        return self.get_task_detail(task_id)

    async def reopen_browser(self, task_id: str) -> TaskDetail | None:
        runtime = self.get_task(task_id)
        if not runtime:
            return None
        if runtime.browser and runtime.browser_context:
            return self.get_task_detail(task_id)

        runtime.browser = CustomBrowser(
            config=BrowserConfig(
                headless=self.settings.headless,
                disable_security=self.settings.disable_security,
                deterministic_rendering=self.settings.deterministic_rendering,
                new_context_config=BrowserContextConfig(
                    window_width=self.settings.browser_width,
                    window_height=self.settings.browser_height,
                ),
            )
        )
        runtime.browser_context = await runtime.browser.new_context(
            config=BrowserContextConfig(
                trace_path=runtime.record.traces_dir,
                save_recording_path=runtime.record.recordings_dir,
                save_downloads_path=runtime.record.downloads_dir,
                window_width=self.settings.browser_width,
                window_height=self.settings.browser_height,
            )
        )
        try:
            page = await runtime.browser_context.get_agent_current_page()
            last_url = runtime.data.steps[-1].url if runtime.data.steps else None
            if last_url:
                await page.goto(last_url)
        except Exception:
            logger.debug("Failed to launch reopen browser page", exc_info=True)

        runtime.record.browser_open = True
        runtime.record.leave_browser_open = True
        runtime.record.updated_at = utcnow()
        await self.storage.save_async(runtime.data)
        return self.get_task_detail(task_id)

    async def _close_browser(self, runtime: TaskRuntime) -> None:
        if runtime.browser_context:
            try:
                await runtime.browser_context.close()
            except Exception:
                logger.debug("Failed to close browser context", exc_info=True)
            runtime.browser_context = None
        if runtime.browser:
            try:
                await runtime.browser.close()
            except Exception:
                logger.debug("Failed to close browser", exc_info=True)
            runtime.browser = None
        if runtime.agent:
            try:
                await runtime.agent.close()
            except Exception:
                logger.debug("Failed to close agent", exc_info=True)
            runtime.agent = None
        if runtime.controller:
            try:
                await runtime.controller.close_mcp_client()
            except Exception:
                logger.debug("Failed to close MCP client", exc_info=True)
            runtime.controller = None
        runtime.record.browser_open = False

    async def _scheduled_runner(self) -> None:
        try:
            while True:
                try:
                    await self._start_due_scheduled_tasks()
                except asyncio.CancelledError:
                    logger.debug("Scheduled runner stopped")
                    raise
                except Exception:
                    logger.exception("Scheduled runner iteration failed", exc_info=True)
                await asyncio.sleep(self.settings.schedule_check_interval_seconds)
        finally:
            # Allow the scheduler to be restarted if it ever exits.
            self._scheduler_task = None

    async def shutdown(self) -> None:
        if self._scheduler_task:
            self._scheduler_task.cancel()
            try:
                await self._scheduler_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            self._scheduler_task = None

    async def delete_task(self, task_id: str) -> bool:
        async with self._lock:
            runtime = self._tasks.pop(task_id, None)
        if not runtime:
            return False

        if runtime.asyncio_task and not runtime.asyncio_task.done():
            if runtime.agent:
                runtime.agent.state.stopped = True
            runtime.asyncio_task.cancel()
            try:
                await runtime.asyncio_task
            except Exception:
                pass

        await self._close_browser(runtime)
        await self.vnc_manager.revoke(task_id)
        await self.storage.delete_async(task_id)
        return True

    async def ensure_vnc_token(self, task_id: str, token: str) -> None:
        await self.vnc_manager.register_existing(task_id, token)

    @staticmethod
    def _prepare_directories(directories: tuple[Path, ...]) -> None:
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
