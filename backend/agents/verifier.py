from .types import Fact, VerificationResult as VerificationResultModel


def verify_fact(fact: Fact) -> VerificationResultModel:
    """
    Deterministic safety gate.

    In the full pipeline, this will enforce:
    - vendor was in allow-list (assumed upstream here),
    - date constraint is exactly matched when provided,
    - version is present and came from upstream data.

    For now, this function focuses on the version presence check so that
    the FastAPI app can be wired end-to-end before the data lake is ready.
    """
    if not fact.version:
        return VerificationResultModel(
            status="abstain",
            verified_version=None,
            reason="MISSING_VERSION",
            evidence_ids=[],
            vendor=fact.vendor,
            date=fact.date_constraint,
        )

    # TODO: once Far's data layer is ready, add stronger checks for
    # exact date matches, evidence lookups, etc.
    evidence_ids = [e.url_or_id or str(idx) for idx, e in enumerate(fact.evidence)]

    return VerificationResultModel(
        status="answer",
        verified_version=fact.version,
        reason=None,
        evidence_ids=evidence_ids,
        vendor=fact.vendor,
        date=fact.date_constraint,
    )


VerificationResult = VerificationResultModel


