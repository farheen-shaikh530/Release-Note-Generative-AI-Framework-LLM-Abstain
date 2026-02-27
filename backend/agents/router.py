from typing import Any, Dict

import httpx

from .. import config
from .types import RouterResult


async def _call_openai_router(prompt: str) -> Dict[str, Any]:
    """
    Lightweight wrapper for the OpenAI HTTP API.

    We deliberately use raw HTTP instead of the heavy SDK to keep the
    example minimal and easy to reason about.
    """
    if not config.SETTINGS.openai_api_key:
        # In local dev without an API key, fall back to a trivial heuristic.
        return {
            "type": "latest_version",
            "vendor_hint": None,
            "date_hint": None,
        }

    headers = {
        "Authorization": f"Bearer {config.SETTINGS.openai_api_key}",
        "Content-Type": "application/json",
    }

    system_prompt = (
        "You are a router for a release intelligence assistant. "
        "Given a single user question, you must output a small JSON object with keys: "
        "`type` (one of: latest_version, version_on_date, unknown), "
        "`vendor_hint` (string or null), "
        "`date_hint` (string in YYYY-MM-DD format or null). "
        "Do not include any other keys. Do not answer the question."
    )

    body = {
        "model": config.SETTINGS.openai_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions", headers=headers, json=body
        )
        resp.raise_for_status()
        data = resp.json()

    try:
        content = data["choices"][0]["message"]["content"]
        # httpx already returns JSON as string; parse again via httpx is overkill
        import json

        return json.loads(content)
    except Exception:
        # On any parsing problem, fall back to a safe default.
        return {
            "type": "latest_version",
            "vendor_hint": None,
            "date_hint": None,
        }


async def route_question(question: str) -> RouterResult:
    """
    Main entrypoint used by the FastAPI app.
    """
    raw = await _call_openai_router(question)

    rtype = raw.get("type") if raw.get("type") in {
        "latest_version",
        "version_on_date",
        "unknown",
    } else "latest_version"

    vendor_hint = raw.get("vendor_hint")
    if isinstance(vendor_hint, str):
        vendor_hint = vendor_hint.strip() or None
    else:
        vendor_hint = None

    date_hint = raw.get("date_hint")
    if isinstance(date_hint, str):
        date_hint = date_hint.strip() or None
    else:
        date_hint = None

    return RouterResult(
        type=rtype,
        vendor_hint=vendor_hint,
        date_hint=date_hint,
        raw_llm_output=raw,
    )

