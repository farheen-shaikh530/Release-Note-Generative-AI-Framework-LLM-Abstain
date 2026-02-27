from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, Optional
import uuid

from . import config
from .agents import router as router_agent
from .agents import vendor_date_gate
from .agents import verifier
from .agents import answer_composer
from .services import trace_store


app = FastAPI(title="ReleaseHub Agents Backend")

# Simple, permissive CORS for hackathon demo; tighten later if needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QuestionRequest(BaseModel):
    question: str


class AnswerResponse(BaseModel):
    query_id: str
    status: str
    answer: str
    vendor: Optional[str] = None
    date: Optional[str] = None
    verified_version: Optional[str] = None
    meta: Dict[str, Any] = {}
    evidence: Any = None


@app.get("/health")
async def health() -> Dict[str, str]:
    # Basic config sanity check
    return {"status": "ok", "environment": config.SETTINGS.environment}


@app.post("/answer", response_model=AnswerResponse)
async def answer(request: QuestionRequest) -> AnswerResponse:
    """
    Orchestrates the full agent pipeline for a single question.
    """
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    query_id = str(uuid.uuid4())
    trace = trace_store.Trace(query_id=query_id, question=request.question)

    # 1) Router agent (OpenAI)
    router_result = await router_agent.route_question(request.question)
    trace.steps.append({"agent": "router", "output": router_result})

    # 2) Vendor + date gate
    vendor_result = await vendor_date_gate.resolve_vendor_and_date(
        question=request.question,
        vendor_hint=router_result.vendor_hint,
        date_hint=router_result.date_hint,
    )
    trace.steps.append({"agent": "vendor_date_gate", "output": vendor_result.dict()})

    if vendor_result.status == "abstain":
        abstain_answer = "I cannot answer because the vendor is not in the trusted allow-list."
        final = AnswerResponse(
            query_id=query_id,
            status="abstain",
            answer=abstain_answer,
            vendor=None,
            date=vendor_result.date,
            verified_version=None,
            meta={"reason": vendor_result.reason},
            evidence=None,
        )
        trace.final_response = final.dict()
        trace_store.store_trace(trace)
        return final

    # Placeholder for downstream agents (retriever, fact_builder, verifier).
    # For now, we only run the verifier in a trivial "no fact" mode so the
    # structure is in place for Dar and Far to integrate with.

    verification = verifier.VerificationResult(
        status="abstain",
        verified_version=None,
        reason="FACT_PIPELINE_NOT_IMPLEMENTED",
        evidence_ids=[],
        vendor=vendor_result.vendor,
        date=vendor_result.date,
    )
    trace.steps.append({"agent": "verifier", "output": verification.dict()})

    final_answer_text = await answer_composer.compose_from_verification(
        question=request.question,
        verification=verification,
    )

    final = AnswerResponse(
        query_id=query_id,
        status=verification.status,
        answer=final_answer_text,
        vendor=verification.vendor,
        date=verification.date,
        verified_version=verification.verified_version,
        meta={"reason": verification.reason},
        evidence=None,
    )
    trace.final_response = final.dict()
    trace_store.store_trace(trace)
    return final


@app.get("/trace/{query_id}")
async def get_trace(query_id: str) -> Dict[str, Any]:
    trace = trace_store.get_trace(query_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found.")
    return trace.dict()

