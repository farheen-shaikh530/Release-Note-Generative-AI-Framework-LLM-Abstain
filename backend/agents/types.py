from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel


class RouterResult(BaseModel):
    type: Literal["latest_version", "version_on_date", "unknown"] = "latest_version"
    vendor_hint: Optional[str] = None
    date_hint: Optional[str] = None
    raw_llm_output: Dict[str, Any] = {}


class VendorDateResult(BaseModel):
    status: Literal["ok", "abstain"]
    vendor: Optional[str]
    date: Optional[str]
    reason: Optional[str] = None


class EvidenceItem(BaseModel):
    source: str
    vendor: str
    observed_version: Optional[str]
    observed_at: Optional[str]
    url_or_id: Optional[str]
    raw_ref: Optional[Dict[str, Any]] = None
    snippets: Optional[List[str]] = None


class Fact(BaseModel):
    vendor: str
    version: Optional[str]
    as_of: Optional[str]
    evidence: List[EvidenceItem]
    type: Literal["latest_version", "version_on_date"]
    date_constraint: Optional[str] = None


class VerificationResult(BaseModel):
    status: Literal["answer", "abstain"]
    verified_version: Optional[str]
    reason: Optional[str]
    evidence_ids: List[str]
    vendor: Optional[str] = None
    date: Optional[str] = None

