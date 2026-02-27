from .types import VerificationResult


async def compose_from_verification(
    question: str,
    verification: VerificationResult,
) -> str:
    """
    For now, keep this simple and deterministic:
    - If status is abstain: return a fixed abstain message with reason.
    - If status is answer: return a short template that includes the verified version.

    Once the rest of the pipeline is wired up, this function can call OpenAI
    to format the answer more nicely while enforcing that the verified
    version string appears verbatim in the output.
    """
    if verification.status == "abstain":
        reason = verification.reason or "insufficient trusted data"
        return f"I don't know from the current evidence ({reason})."

    if not verification.verified_version:
        return "I don't know from the current evidence (no verified version)."

    vendor_part = f" for {verification.vendor}" if verification.vendor else ""
    date_part = f" on {verification.date}" if verification.date else ""
    return (
        f"The latest verified version{vendor_part}{date_part} is "
        f"{verification.verified_version}."
    )

