from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Trace:
    query_id: str
    question: str
    steps: List[Dict[str, Any]] = field(default_factory=list)
    final_response: Optional[Dict[str, Any]] = None

    def dict(self) -> Dict[str, Any]:
        return {
            "query_id": self.query_id,
            "question": self.question,
            "steps": self.steps,
            "final_response": self.final_response,
        }


_TRACE_STORE: Dict[str, Trace] = {}


def store_trace(trace: Trace) -> None:
    _TRACE_STORE[trace.query_id] = trace


def get_trace(query_id: str) -> Optional[Trace]:
    return _TRACE_STORE.get(query_id)

