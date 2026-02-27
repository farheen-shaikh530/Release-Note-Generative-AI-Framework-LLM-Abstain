import re
from typing import List, Optional

import httpx

from .. import config
from .types import VendorDateResult


async def _fetch_vendor_list() -> List[str]:
    """
    Fetch the vendor allow-list from Releasetrain.
    In a full implementation this would be cached with TTL; for the hackathon
    we keep it simple and rely on external caching or short-lived runs.
    """
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(str(config.SETTINGS.releasetrain_vendor_api))
        resp.raise_for_status()
        data = resp.json()

    # The API is expected to return a list of vendor names.
    return [str(v).lower() for v in data]


def _longest_vendor_match(question_lower: str, vendors: List[str]) -> Optional[str]:
    """
    Longest-match-wins vendor detection to avoid collisions like:
    'slimbook' vs 'slimbook os'.
    """
    best_match = None
    for vendor in vendors:
        if vendor in question_lower:
            if best_match is None or len(vendor) > len(best_match):
                best_match = vendor
    return best_match


def _extract_date(question: str, date_hint: Optional[str]) -> Optional[str]:
    """
    Extract an ISO date (YYYY-MM-DD) if present.
    For now, we support direct ISO patterns. A future enhancement can add
    an OpenAI call to parse natural language dates.
    """
    if date_hint:
        return date_hint

    # Simple regex for YYYY-MM-DD
    m = re.search(r"(20[0-9]{2}-[01][0-9]-[0-3][0-9])", question)
    if m:
        return m.group(1)
    return None


async def resolve_vendor_and_date(
    question: str,
    vendor_hint: Optional[str],
    date_hint: Optional[str],
) -> VendorDateResult:
    """
    Resolve the vendor (via allow-list) and date constraint for a question.
    """
    question_lower = question.lower()
    vendors = await _fetch_vendor_list()

    # Prefer the vendor_hint if it directly matches an allow-listed vendor.
    normalized_hint = vendor_hint.lower() if vendor_hint else None
    vendor = None
    if normalized_hint and normalized_hint in vendors:
        vendor = normalized_hint
    else:
        vendor = _longest_vendor_match(question_lower, vendors)

    if not vendor:
        return VendorDateResult(
            status="abstain",
            vendor=None,
            date=None,
            reason="UNKNOWN_VENDOR",
        )

    date = _extract_date(question, date_hint)
    return VendorDateResult(status="ok", vendor=vendor, date=date)

