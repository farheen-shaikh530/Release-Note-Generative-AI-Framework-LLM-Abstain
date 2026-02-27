# ReleaseHub Agents (Backend)

This is the backend service for **ReleaseHub Agents**, a safety-first release/version intelligence assistant.

It exposes HTTP APIs that:
- Accept a natural language question about OS/software releases.
- Run the question through a chain of agents (router, vendor/date gate, retriever, fact builder, verifier, answer composer).
- Return either a verified version answer with evidence, or an explicit abstain response.

## Tech stack

- **FastAPI** for the HTTP API.
- **OpenAI** for limited-language tasks (classification + answer formatting).
- **httpx/requests** for calling Releasetrain, Tavily and other HTTP APIs.
- **Neo4j** (via a separate client module) for writing explanation graphs.

The data-lake layer (Postgres + Node.js, optional Redis cache) and Neo4j implementation are owned by the data/graph services. The data lake exposes `GET /facts/latest`, `GET /facts/on-date`, and `POST /ingest`. When `REDIS_HOST` is set (Render Key Value), fact lookups are cached (5–10 min TTL) for faster repeat queries.

## Running locally

1. Create and activate a virtual environment (optional but recommended):

```bash
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set the required environment variables (at minimum):

- `OPENAI_API_KEY`
- `RELEASETRAIN_VENDOR_API` (default: `https://releasetrain.io/api/c/names`)
- `RELEASETRAIN_COMPONENT_API` (default: `https://releasetrain.io/api/component?q=os`)
- `TAVILY_API_KEY` (if using Tavily)
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` (if Neo4j is enabled)

You can store these in a `.env` file during development.

4. Run the development server:

```bash
uvicorn backend.main:app --reload
```

The health-check endpoint will be available at `GET /health`.

## Render deployment

On Render, configure a **Web Service**:

- Start command: `uvicorn backend.main:app --host 0.0.0.0 --port 10000`
- Environment: Python 3.11+ recommended.
- Add the same environment variables as above in the Render dashboard.

## High-level API

- `GET /health` – simple health check.
- `POST /answer` – main endpoint to run the agent pipeline.
- `GET /trace/{query_id}` – returns the internal agent trace for a past query (for the UI debug panel).

The detailed contract for `/answer` and `/trace` will be finalised once all agents are wired together.

