import asyncio
import inspect
import logging
import os
from typing import Any, Awaitable, Callable, Dict, Optional, Type, TypeVar, Union

import pyperclip
from browser_use.agent.views import ActionModel, ActionResult
from browser_use.browser.context import BrowserContext
from browser_use.controller.registry.service import RegisteredAction
from browser_use.controller.service import Controller
from browser_use.controller.views import (
    ClickElementAction,
    DoneAction,
    ExtractPageContentAction,
    GoToUrlAction,
    InputTextAction,
    OpenTabAction,
    ScrollAction,
    SearchGoogleAction,
    SendKeysAction,
    SwitchTabAction,
)
from browser_use.controller.views import DoneAction as ControllerDoneAction
from langchain_core.language_models.chat_models import BaseChatModel
from main_content_extractor import MainContentExtractor
from pydantic import BaseModel

from browser_use.agent.views import ActionResult
from browser_use.browser.context import BrowserContext
from browser_use.controller.registry.service import Registry
from browser_use.controller.service import DoneAction as BaseDoneAction

from browser_use.utils import time_execution_sync
from .mcp import create_tool_param_model, setup_mcp_client_and_tools

logger = logging.getLogger(__name__)

Context = TypeVar("Context")


class CustomController(Controller):
    def __init__(
        self,
        exclude_actions: list[str] | None = None,
        output_model: Optional[Type[BaseModel]] = None,
        ask_assistant_callback: Optional[
            Union[
                Callable[[str, BrowserContext], Dict[str, Any]],
                Callable[[str, BrowserContext], Awaitable[Dict[str, Any]]],
            ]
        ] = None,
    ):
        super().__init__(exclude_actions=exclude_actions or [], output_model=output_model)
        self._register_custom_actions()
        self.ask_assistant_callback = ask_assistant_callback
        self.mcp_client = None
        self.mcp_server_config = None

    def _register_custom_actions(self):
        @self.registry.action(
            "When executing tasks, prioritize autonomous completion. However, if you encounter a definitive blocker "
            "that prevents you from proceeding independently – such as needing credentials you don't possess, "
            "requiring subjective human judgment, needing a physical action performed, encountering complex CAPTCHAs, "
            "or facing limitations in your capabilities – you must request human assistance."
        )
        async def ask_for_assistant(query: str, browser: BrowserContext):
            if self.ask_assistant_callback:
                if inspect.iscoroutinefunction(self.ask_assistant_callback):
                    user_response = await self.ask_assistant_callback(query, browser)
                else:
                    user_response = self.ask_assistant_callback(query, browser)
                    if inspect.isawaitable(user_response):
                        user_response = await user_response
                msg = f"AI ask: {query}. User response: {user_response['response']}"
                logger.info(msg)
                return ActionResult(extracted_content=msg, include_in_memory=True)
            else:
                return ActionResult(
                    extracted_content="Human cannot help you. Please try another way.",
                    include_in_memory=True,
                )

        @self.registry.action("Upload file to interactive element with file path ")
        async def upload_file(
            index: int, path: str, browser: BrowserContext, available_file_paths: list[str]
        ):
            if path not in available_file_paths:
                return ActionResult(error=f"File path {path} is not available")

            if not os.path.exists(path):
                return ActionResult(error=f"File {path} does not exist")

            dom_el = await browser.get_dom_element_by_index(index)

            file_upload_dom_el = dom_el.get_file_upload_element()

            if file_upload_dom_el is None:
                msg = f"No file upload element found at index {index}"
                logger.info(msg)
                return ActionResult(error=msg)

            file_upload_el = await browser.get_locate_element(file_upload_dom_el)

            if file_upload_el is None:
                msg = f"No file upload element found at index {index}"
                logger.info(msg)
                return ActionResult(error=msg)

            try:
                await file_upload_el.set_input_files(path)
                msg = f"Successfully uploaded file to index {index}"
                logger.info(msg)
                return ActionResult(extracted_content=msg, include_in_memory=True)
            except Exception as e:
                msg = f"Failed to upload file to index {index}: {str(e)}"
                logger.info(msg)
                return ActionResult(error=msg)

    @time_execution_sync("--act")
    async def act(
        self,
        action: ActionModel,
        browser_context: Optional[BrowserContext] = None,
        page_extraction_llm: Optional[BaseChatModel] = None,
        sensitive_data: Optional[Dict[str, str]] = None,
        available_file_paths: Optional[list[str]] = None,
        context: Context | None = None,
    ) -> ActionResult:
        try:
            for action_name, params in action.model_dump(exclude_unset=True).items():
                if params is not None:
                    if action_name.startswith("mcp"):
                        logger.debug(f"Invoke MCP tool: {action_name}")
                        mcp_tool = self.registry.registry.actions.get(action_name).function
                        result = await mcp_tool.ainvoke(params)
                    else:
                        result = await self.registry.execute_action(
                            action_name,
                            params,
                            browser=browser_context,
                            page_extraction_llm=page_extraction_llm,
                            sensitive_data=sensitive_data,
                            available_file_paths=available_file_paths,
                            context=context,
                        )

                    if isinstance(result, str):
                        return ActionResult(extracted_content=result)
                    elif isinstance(result, ActionResult):
                        return result
                    elif result is None:
                        return ActionResult()
                    else:
                        raise ValueError(
                            f"Invalid action result type: {type(result)} of {result}"
                        )
            return ActionResult()
        except Exception as e:
            raise e

    async def setup_mcp_client(self, mcp_server_config: Optional[Dict[str, Any]] = None):
        self.mcp_server_config = mcp_server_config
        if self.mcp_server_config:
            self.mcp_client = await setup_mcp_client_and_tools(self.mcp_server_config)
            self.register_mcp_tools()

    def register_mcp_tools(self):
        if self.mcp_client:
            for server_name in self.mcp_client.server_name_to_tools:
                for tool in self.mcp_client.server_name_to_tools[server_name]:
                    tool_name = f"mcp.{server_name}.{tool.name}"
                    self.registry.registry.actions[tool_name] = RegisteredAction(
                        name=tool_name,
                        description=tool.description,
                        function=tool,
                        param_model=create_tool_param_model(tool),
                    )
                    logger.info(f"Add mcp tool: {tool_name}")
        else:
            logger.warning("MCP client not started.")

    async def close_mcp_client(self):
        if self.mcp_client:
            await self.mcp_client.__aexit__(None, None, None)
