import React, { useState } from "react";
import "./release-notes.css";

const SUGGESTIONS = [
  "Show latest production releases only",
  "Summarize critical CVEs from last 7 days",
  "Generate executive-friendly monthly release digest"
];

const STATUS_COLORS = {
  answer: "status-answer",
  abstain: "status-abstain",
  error: "status-error"
};

export function ReleaseNotesApp() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "graph"

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("idle"); // "idle" | "answer" | "abstain" | "error"
  const [meta, setMeta] = useState({ vendor: "", version: "", source: "" });
  const [coreEvidence, setCoreEvidence] = useState([]);
  const [extraEvidence, setExtraEvidence] = useState([]);
  const [traceJson, setTraceJson] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState({
    lastRefresh: null,
    sources: []
  });

  const handleSuggestionClick = (text) => {
    setQuery(text);
  };

  const handleAsk = async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError("");
    setStatus("idle");

    const apiBase = import.meta.env.VITE_API_URL || "";
    try {
      const [answerRes, traceRes] = await Promise.allSettled([
        fetch(`${apiBase}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed })
        }),
        fetch(`${apiBase}/trace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed })
        })
      ]);

      if (answerRes.status === "fulfilled" && answerRes.value.ok) {
        const data = await answerRes.value.json();

        setAnswer(data.answer ?? "");
        setStatus(data.status === "abstain" ? "abstain" : "answer");
        setMeta({
          vendor: data.vendor ?? "Unknown vendor",
          version: data.version ?? "N/A",
          source: data.source ?? "Release Hub"
        });
        setCoreEvidence(data.coreEvidence ?? []);
        setExtraEvidence(data.extraEvidence ?? []);
      } else {
        setStatus("error");
        setAnswer("");
        setMeta({ vendor: "", version: "", source: "" });
        setCoreEvidence([]);
        setExtraEvidence([]);
        setError("Failed to fetch answer from /answer. Check backend.");
      }

      if (traceRes.status === "fulfilled" && traceRes.value.ok) {
        const traceData = await traceRes.value.json();
        setTraceJson(JSON.stringify(traceData, null, 2));

        const ds = traceData.dataStatus || traceData.data_status;
        if (ds) {
          setDataStatus({
            lastRefresh: ds.lastRefresh ?? ds.last_refresh ?? null,
            sources: Array.isArray(ds.sources) ? ds.sources : []
          });
        }
      } else {
        setTraceJson("");
      }
    } catch (e) {
      setStatus("error");
      setError("Unexpected error contacting backend.");
      setAnswer("");
      setMeta({ vendor: "", version: "", source: "" });
      setCoreEvidence([]);
      setExtraEvidence([]);
    } finally {
      setLoading(false);
      setDebugOpen(true);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const statusClass = STATUS_COLORS[status] ?? "";
  const statusLabel =
    status === "answer"
      ? "Answered"
      : status === "abstain"
      ? "Abstained (no safe answer)"
      : status === "error"
      ? "Error"
      : "Idle";

  return (
    <div
      className={`rn-root rn-root-hero ${
        darkMode ? "rn-theme-dark" : "rn-theme-light"
      }`}
    >
      <div className="rn-hero-overlay" />

      <header className="rn-hero-header">
        <div className="rn-hero-title-group">
          <h1 className="rn-hero-title rn-hero-title-agent">
            <span className="rn-hero-gradient">ReleaseHub</span>
            <span className="rn-agent-badge">Agent</span>
          </h1>
        </div>

        <div className="rn-hero-header-actions">
          <div className="rn-tab-group">
            <button
              className={`rn-tab ${activeTab === "chat" ? "rn-tab-active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              Chat
            </button>
            <button
              className={`rn-tab ${activeTab === "graph" ? "rn-tab-active" : ""}`}
              onClick={() => setActiveTab("graph")}
            >
              Neo4j Graph
            </button>
          </div>

          <div className="rn-hero-header-actions-right">
            <div className="rn-toggle-group">
              <button
                className={`rn-pill-btn ${
                  darkMode ? "rn-pill-active" : ""
                }`}
                onClick={() => setDarkMode(true)}
              >
                Dark
              </button>
              <button
                className={`rn-pill-btn ${
                  !darkMode ? "rn-pill-active" : ""
                }`}
                onClick={() => setDarkMode(false)}
              >
                Light
              </button>
            </div>
            <button className="rn-ghost-chip">Settings</button>
          </div>
        </div>
      </header>

      <main className="rn-hero-main">
        {activeTab === "chat" ? (
          <div className="rn-chat-layout rn-chat-layout-bottom-input">
            <section className="rn-chat-scroll-area">
              <div className="rn-chat-content-grid">
                <div className="rn-chat-column">
                  <div className="rn-chat-card">
                    <div className="rn-chat-header">
                      <div className="rn-env-pill">Prod · Render</div>
                      <div className={`rn-status-pill ${statusClass}`}>
                        {statusLabel}
                      </div>
                    </div>
                  </div>
                  <AnswerCard
                    answer={answer}
                    meta={meta}
                    status={status}
                    loading={loading}
                    error={error}
                  />
                </div>
                <section className="rn-side-column">
              <DataStatus dataStatus={dataStatus} loading={loading} />
              <EvidencePanel
                coreEvidence={coreEvidence}
                extraEvidence={extraEvidence}
                loading={loading}
              />

              <DebugPanel
                open={debugOpen}
                onToggle={() => setDebugOpen((o) => !o)}
                traceJson={traceJson}
              />
                </section>
              </div>
            </section>

            <section className="rn-input-bar">
              <div className="rn-input-bar-inner">
                <textarea
                  className="rn-chat-textarea rn-chat-textarea-full"
                  placeholder="Ask about versions, CVEs, patches… (e.g. What is the patch for Linux on 14-02-2026?)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                />
                <div className="rn-input-bar-actions">
                  <div className="rn-suggestion-row">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="rn-suggestion-pill"
                        onClick={() => handleSuggestionClick(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="rn-primary-btn"
                    onClick={handleAsk}
                    disabled={loading}
                  >
                    {loading ? "Thinking…" : "Ask"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <GraphTab />
        )}
      </main>
    </div>
  );
}

function AnswerCard({ answer, meta, status, loading, error }) {
  return (
    <div className="rn-answer-card">
      <div className="rn-answer-header">
        <div>
          <div className="rn-answer-title">Answer</div>
          <div className="rn-answer-meta">
            {meta.vendor && <span>{meta.vendor}</span>}
            {meta.version && <span>· v{meta.version}</span>}
            {meta.source && <span>· {meta.source}</span>}
          </div>
        </div>
      </div>

      <div className="rn-answer-body">
        {loading && (
          <div className="rn-skeleton-lines">
            <div />
            <div />
            <div />
          </div>
        )}

        {!loading && error && (
          <div className="rn-answer-error">{error}</div>
        )}

        {!loading && !error && !answer && (
          <p className="rn-answer-placeholder">
            Ask a question to see a structured answer here, including when the
            system chooses to abstain.
          </p>
        )}

        {!loading && !error && answer && (
          <p className="rn-answer-text">{answer}</p>
        )}

        {status === "abstain" && !loading && !error && (
          <p className="rn-abstain-note">
            The system abstained because it could not find enough trustworthy,
            vendor‑verified evidence to answer safely.
          </p>
        )}
      </div>
    </div>
  );
}

function DataStatus({ dataStatus, loading }) {
  const hasSources = dataStatus?.sources && dataStatus.sources.length > 0;

  return (
    <div className="rn-data-status">
      <div className="rn-section-header">
        <span>Data status</span>
        <span className="rn-section-pill-soft">Lake</span>
      </div>

      {loading && <div className="rn-skeleton-block rn-skeleton-compact" />}

      {!loading && (
        <div className="rn-data-status-body">
          <div className="rn-data-status-row">
            <span className="rn-data-status-label">Last lake refresh</span>
            <span className="rn-data-status-value">
              {dataStatus?.lastRefresh || "Unknown"}
            </span>
          </div>
          <div className="rn-data-status-row">
            <span className="rn-data-status-label">Sources</span>
            <span className="rn-data-status-value">
              {hasSources
                ? dataStatus.sources.join(", ")
                : "Releasetrain components, Reddit (planned)"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function EvidencePanel({ coreEvidence, extraEvidence, loading }) {
  const hasAny =
    (coreEvidence && coreEvidence.length > 0) ||
    (extraEvidence && extraEvidence.length > 0);

  return (
    <div className="rn-evidence-panel">
      <div className="rn-section-header">
        <span>Evidence</span>
        <span className="rn-evidence-badge">Model‑visible</span>
      </div>

      {loading && (
        <div className="rn-skeleton-block" />
      )}

      {!loading && !hasAny && (
        <p className="rn-evidence-placeholder">
          When you ask a question, core evidence from{" "}
          <span className="rn-inline-pill">Releasetrain</span> and extra
          context from <span className="rn-inline-pill">Tavily</span> will show
          up here.
        </p>
      )}

      {!loading && hasAny && (
        <div className="rn-evidence-columns">
          <EvidenceColumn
            title="Core evidence (Releasetrain)"
            items={coreEvidence}
          />
          <EvidenceColumn
            title="Extra evidence (Tavily)"
            items={extraEvidence}
          />
        </div>
      )}
    </div>
  );
}

function EvidenceColumn({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rn-evidence-column">
      <div className="rn-evidence-title">{title}</div>
      <ul className="rn-evidence-list">
        {items.map((item, idx) => (
          <li key={idx}>
            {typeof item === "string" ? item : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DebugPanel({ open, onToggle, traceJson }) {
  return (
    <div className="rn-debug-wrapper">
      <button className="rn-debug-toggle" onClick={onToggle}>
        <span className="rn-debug-chevron">{open ? "▾" : "▸"}</span>
        <span className="rn-debug-title">Debug / trace JSON</span>
        <span className="rn-debug-badge">Safe to share</span>
      </button>
      {open && (
        <div className="rn-debug-body">
          {traceJson ? (
            <pre className="rn-debug-pre">{traceJson}</pre>
          ) : (
            <p className="rn-debug-placeholder">
              Call `/trace` on the backend and return JSON here to see the full
              routing and evidence chain.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GraphTab() {
  return (
    <div className="rn-graph-tab">
      <div className="rn-section-header">
        <span>Neo4j graph</span>
        <span className="rn-section-pill-soft">Topology view</span>
      </div>
      <p className="rn-graph-description">
        This tab is designed to embed a Neo4j graph of vendors, releases, and
        CVEs. You can either:
      </p>
      <ul className="rn-graph-options">
        <li>Embed a Neo4j Browser / Bloom view in an iframe, or</li>
        <li>Render a PNG/SVG from your graph (e.g. from Far/Manu) here.</li>
      </ul>
      <div className="rn-graph-placeholder">
        <span>Neo4j graph placeholder</span>
      </div>
    </div>
  );
}
