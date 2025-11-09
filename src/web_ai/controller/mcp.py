import inspect
import logging
import uuid
from datetime import date, datetime, time
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Type, Union, get_type_hints

from browser_use.controller.registry.views import ActionModel
from langchain.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from pydantic import BaseModel, Field, create_model
from pydantic.v1 import BaseModel as BaseModelV1
from pydantic.v1 import Field as FieldV1

logger = logging.getLogger(__name__)


async def setup_mcp_client_and_tools(
    mcp_server_config: Dict[str, Any]
) -> Optional[MultiServerMCPClient]:
    if not mcp_server_config:
        logger.error("No MCP server configuration provided.")
        return None

    try:
        if "mcpServers" in mcp_server_config:
            mcp_server_config = mcp_server_config["mcpServers"]
        client = MultiServerMCPClient(mcp_server_config)
        await client.__aenter__()
        return client
    except Exception as e:
        logger.error(f"Failed to setup MCP client or fetch tools: {e}", exc_info=True)
        return None


def create_tool_param_model(tool: BaseTool) -> Type[BaseModel]:
    json_schema = tool.args_schema
    tool_name = tool.name

    if json_schema is not None:
        params: dict[str, Any] = {}
        if "properties" in json_schema:
            required_fields: Set[str] = set(json_schema.get("required", []))

            for prop_name, prop_details in json_schema["properties"].items():
                field_type = resolve_type(prop_details, f"{tool_name}_{prop_name}")
                is_required = prop_name in required_fields
                default_value = prop_details.get("default", ... if is_required else None)
                description = prop_details.get("description", "")

                field_kwargs = {"default": default_value}
                if description:
                    field_kwargs["description"] = description

                if "minimum" in prop_details:
                    field_kwargs["ge"] = prop_details["minimum"]
                if "maximum" in prop_details:
                    field_kwargs["le"] = prop_details["maximum"]
                if "minLength" in prop_details:
                    field_kwargs["min_length"] = prop_details["minLength"]
                if "maxLength" in prop_details:
                    field_kwargs["max_length"] = prop_details["maxLength"]
                if "pattern" in prop_details:
                    field_kwargs["pattern"] = prop_details["pattern"]

                params[prop_name] = (field_type, Field(**field_kwargs))

        return create_model(
            f"{tool_name}_parameters",
            __base__=ActionModel,
            **params,
        )

    run_method = tool._run
    sig = inspect.signature(run_method)

    try:
        type_hints = get_type_hints(run_method)
    except Exception:
        type_hints = {}

    params = {}
    for name, param in sig.parameters.items():
        if name == "self":
            continue
        annotation = type_hints.get(name, param.annotation)
        if annotation == inspect.Parameter.empty:
            annotation = Any
        if param.default != param.empty:
            params[name] = (annotation, param.default)
        else:
            params[name] = (annotation, ...)

    return create_model(
        f"{tool_name}_parameters",
        __base__=ActionModel,
        **params,
    )


def resolve_type(prop_details: Dict[str, Any], prefix: str = "") -> Any:
    if "$ref" in prop_details:
        return Any

    type_mapping = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": List,
        "object": Dict,
        "null": type(None),
    }

    if prop_details.get("type") == "string" and "format" in prop_details:
        format_mapping = {
            "date-time": datetime,
            "date": date,
            "time": time,
            "email": str,
            "uri": str,
            "url": str,
            "uuid": uuid.UUID,
            "binary": bytes,
        }
        return format_mapping.get(prop_details["format"], str)

    if "enum" in prop_details:
        enum_values = prop_details["enum"]
        enum_dict = {}
        for i, v in enumerate(enum_values):
            if isinstance(v, str):
                key = v.upper().replace(" ", "_").replace("-", "_")
                if not key.isidentifier():
                    key = f"VALUE_{i}"
            else:
                key = f"VALUE_{i}"
            enum_dict[key] = v

        if enum_dict:
            return Enum(f"{prefix}_Enum", enum_dict)
        return str

    if prop_details.get("type") == "array" and "items" in prop_details:
        item_type = resolve_type(prop_details["items"], f"{prefix}_item")
        return List[item_type]  # type: ignore

    if prop_details.get("type") == "object" and "properties" in prop_details:
        nested_params: dict[str, Any] = {}
        for nested_name, nested_details in prop_details["properties"].items():
            nested_type = resolve_type(nested_details, f"{prefix}_{nested_name}")
            required_fields = prop_details.get("required", [])
            is_required = nested_name in required_fields
            default_value = nested_details.get(
                "default", ... if is_required else None
            )
            description = nested_details.get("description", "")

            field_kwargs = {"default": default_value}
            if description:
                field_kwargs["description"] = description

            nested_params[nested_name] = (nested_type, Field(**field_kwargs))

        nested_model = create_model(f"{prefix}_Model", **nested_params)
        return nested_model

    if "oneOf" in prop_details or "anyOf" in prop_details:
        union_schema = prop_details.get("oneOf") or prop_details.get("anyOf")
        union_types = []
        for i, t in enumerate(union_schema):
            union_types.append(resolve_type(t, f"{prefix}_{i}"))
        if union_types:
            return Union.__getitem__(tuple(union_types))  # type: ignore
        return Any

    if "allOf" in prop_details:
        nested_params = {}
        for i, schema_part in enumerate(prop_details["allOf"]):
            if "properties" in schema_part:
                for nested_name, nested_details in schema_part["properties"].items():
                    nested_type = resolve_type(
                        nested_details, f"{prefix}_allOf_{i}_{nested_name}"
                    )
                    required_fields = schema_part.get("required", [])
                    is_required = nested_name in required_fields
                    nested_params[nested_name] = (
                        nested_type,
                        ... if is_required else None,
                    )

        if nested_params:
            composite_model = create_model(
                f"{prefix}_CompositeModel", **nested_params
            )
            return composite_model
        return Dict

    schema_type = prop_details.get("type", "string")
    if isinstance(schema_type, list):
        non_null_types = [t for t in schema_type if t != "null"]
        if non_null_types:
            primary_type = type_mapping.get(non_null_types[0], Any)
            if "null" in schema_type:
                return Optional[primary_type]  # type: ignore
            return primary_type
        return Any

    return type_mapping.get(schema_type, Any)
