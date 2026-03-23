import express from 'express';
import { createClient } from 'redis';
import {
  fetchOSComponents,
  findOSByProductAndDate,
  fetchPatchSearch,
  fetchPatchSearchAll,
  findLinuxPatchByDate,
  formatLinuxPatchResponse,
  docHasVendor,
} from './releasetrain.js';
import { formatOSResponse } from './schema-os.js';

const app = express();
app.use(express.json());

/** Health check for load balancers / PaaS (Render, Fly, etc.) */
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'releasehub-api' });
});

// Allow frontend on another origin (e.g. Vite dev server) to call the API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const VENDORS_NAMES_URL = 'https://releasetrain.io/api/c/names';
const REDIS_KEY_LAST_PROMPTS = 'releasehub:last_prompts';
const REDIS_KEY_ANALYTICS_EVENTS = 'releasehub:analytics_events';
const MAX_LAST_PROMPTS = 3;
const MAX_ANALYTICS_EVENTS = 5000;

let cachedVendorNames = null;
let cachedVendorNamesFetchedAt = 0;
const VENDORS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const analyticsEvents = [];

function getDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function recordAnalyticsEvent({ status, flow, vendor, latencyMs, reason, isVendorFound }) {
  const event = {
    ts: Date.now(),
    status: status || 'unknown',
    flow: flow || 'unknown',
    vendor: (vendor || 'unknown').toString(),
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    reason: reason || null,
    isVendorFound: isVendorFound === 1 ? 1 : isVendorFound === 0 ? 0 : null,
  };
  analyticsEvents.push(event);
  if (analyticsEvents.length > MAX_ANALYTICS_EVENTS) {
    analyticsEvents.splice(0, analyticsEvents.length - MAX_ANALYTICS_EVENTS);
  }
  if (redisClient) {
    // Write-through cache for "Recent events" so analytics survives process restarts.
    redisClient
      .lPush(REDIS_KEY_ANALYTICS_EVENTS, JSON.stringify(event))
      .then(() => redisClient?.lTrim(REDIS_KEY_ANALYTICS_EVENTS, 0, MAX_ANALYTICS_EVENTS - 1))
      .catch((e) => console.warn('Redis analytics event cache write:', e.message));
  }
}

/** Last N calendar days (system local date keys), oldest first. */
function getDayRangeKeys(rangeDays) {
  const n = Math.min(90, Math.max(1, Number(rangeDays) || 1));
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(getDayKey(Date.now() - i * 86400000));
  }
  return keys;
}

function filterAnalyticsEvents({ rangeDays = 1, flow = 'all', status = 'all', vendor = '' }) {
  const dayKeys = getDayRangeKeys(rangeDays);
  const startDay = dayKeys[0];
  const endDay = dayKeys[dayKeys.length - 1];
  let list = analyticsEvents.filter((e) => {
    const d = getDayKey(e.ts);
    return d >= startDay && d <= endDay;
  });
  if (flow && flow !== 'all') list = list.filter((e) => e.flow === flow);
  if (status && status !== 'all') list = list.filter((e) => e.status === status);
  if (vendor && String(vendor).trim()) {
    const v = String(vendor).trim().toLowerCase();
    list = list.filter((e) => (e.vendor || '').toLowerCase() === v || (e.vendor || '').toLowerCase().includes(v));
  }
  return { list, dayKeys };
}

function buildAnalyticsSummaryFromEvents(list, dayKeys) {
  const totalQuestions = list.length;
  const abstainCount = list.filter((e) => e.status === 'abstain').length;
  const answeredCount = list.filter((e) => e.status === 'answer').length;
  const errorCount = list.filter((e) => e.status === 'error').length;
  const latencies = list.map((e) => e.latencyMs).filter((v) => Number.isFinite(v));
  const vendorCounts = new Map();
  for (const e of list) {
    const key = (e.vendor || 'unknown').toString().trim() || 'unknown';
    vendorCounts.set(key, (vendorCounts.get(key) || 0) + 1);
  }
  const topVendors = [...vendorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([vendor, count]) => ({ vendor, count }));

  const reasonCounts = new Map();
  for (const e of list) {
    if (e.status === 'abstain' || e.status === 'error') {
      const r = e.reason || (e.status === 'error' ? 'error' : 'unknown');
      reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
    }
  }
  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));

  const perDay = Object.fromEntries(dayKeys.map((d) => [d, 0]));
  for (const e of list) {
    const d = getDayKey(e.ts);
    if (d in perDay) perDay[d] += 1;
  }
  const timeBuckets = dayKeys.map((day) => ({ day, count: perDay[day] }));

  const maxVendorCount = topVendors.length ? Math.max(...topVendors.map((v) => v.count), 1) : 1;
  const maxDayCount = timeBuckets.length ? Math.max(...timeBuckets.map((b) => b.count), 1) : 1;

  return {
    totalQuestions,
    answeredCount,
    abstainCount,
    errorCount,
    abstainRate: totalQuestions ? Number(((abstainCount / totalQuestions) * 100).toFixed(2)) : 0,
    answerRate: totalQuestions ? Number(((answeredCount / totalQuestions) * 100).toFixed(2)) : 0,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      average: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : null,
    },
    topVendors,
    topReasons,
    timeBuckets,
    maxVendorCount,
    maxDayCount,
  };
}

/** KPI breakdown for the same filtered event list as charts (range + vendor + flow + status). */
function buildKpiBreakdown(list) {
  const queriesAnswered = list.filter((e) => e.status === 'answer').length;
  const queriesAbstain = list.filter((e) => e.status === 'abstain').length;
  const vendorNotFoundCount = list.filter((e) => e.isVendorFound === 0).length;
  const osVersionQueryCount = list.filter((e) => e.flow === 'os').length;
  const patchQueryCount = list.filter((e) => e.flow === 'patch').length;
  return {
    queriesAnswered,
    queriesAbstain,
    /** @deprecated use queriesAnswered */
    respondedCount: queriesAnswered,
    /** @deprecated use queriesAbstain */
    abstainCountKpi: queriesAbstain,
    vendorNotFoundCount,
    osQueryCount: osVersionQueryCount,
    patchQueryCount,
    osVersionQueryCount,
  };
}

function getAnalyticsSummaryQuery(opts) {
  const rangeDays = Math.min(90, Math.max(1, Number(opts.rangeDays) || 1));
  const flowRaw = String(opts.flow ?? 'all').toLowerCase();
  const flow = ['all', 'os', 'patch'].includes(flowRaw) ? flowRaw : 'all';
  const statusRaw = String(opts.status ?? 'all').toLowerCase();
  const status = ['all', 'answer', 'abstain', 'error'].includes(statusRaw) ? statusRaw : 'all';
  const vendor = String(opts.vendor || '').trim();
  const { list, dayKeys } = filterAnalyticsEvents({ rangeDays, flow, status, vendor });
  const summary = buildAnalyticsSummaryFromEvents(list, dayKeys);
  const kpiBreakdown = buildKpiBreakdown(list);
  const recent = [...list]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12)
    .map((e) => ({
      ts: e.ts,
      status: e.status,
      flow: e.flow,
      vendor: e.vendor,
      latencyMs: e.latencyMs,
      reason: e.reason,
      isVendorFound: e.isVendorFound,
    }));
  return {
    rangeDays,
    dayFrom: dayKeys[0],
    dayTo: dayKeys[dayKeys.length - 1],
    filters: { flow, status, vendor: vendor || null },
    ...summary,
    ...kpiBreakdown,
    recent,
  };
}

let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.warn('Redis:', err.message));
    redisClient.connect()
      .then(() => hydrateAnalyticsEventsFromCache())
      .catch(() => { redisClient = null; });
  } catch {
    redisClient = null;
  }
}

async function hydrateAnalyticsEventsFromCache() {
  if (!redisClient) return;
  try {
    const cached = await redisClient.lRange(REDIS_KEY_ANALYTICS_EVENTS, 0, MAX_ANALYTICS_EVENTS - 1);
    if (!Array.isArray(cached) || cached.length === 0) return;
    const parsed = [];
    // lPush stores newest first; reverse to keep oldest->newest in memory list.
    for (const raw of [...cached].reverse()) {
      try {
        const ev = JSON.parse(raw);
        if (ev && typeof ev === 'object') parsed.push(ev);
      } catch {
        // ignore malformed cache entries
      }
    }
    if (parsed.length > 0) {
      analyticsEvents.splice(0, analyticsEvents.length, ...parsed.slice(-MAX_ANALYTICS_EVENTS));
    }
  } catch (e) {
    console.warn('Redis analytics event cache hydrate:', e.message);
  }
}

async function pushLastPrompt(question) {
  const q = (question || '').trim();
  if (!q || !redisClient) return;
  try {
    await redisClient.lPush(REDIS_KEY_LAST_PROMPTS, q);
    await redisClient.lTrim(REDIS_KEY_LAST_PROMPTS, 0, MAX_LAST_PROMPTS - 1);
  } catch (e) {
    console.warn('Redis pushLastPrompt:', e.message);
  }
}

async function getVendorNames() {
  const now = Date.now();
  if (cachedVendorNames && now - cachedVendorNamesFetchedAt < VENDORS_CACHE_TTL_MS) {
    return cachedVendorNames;
  }
  try {
    const r = await fetch(VENDORS_NAMES_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Vendors API error: ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.names ?? data?.data ?? []);
    cachedVendorNames = Array.isArray(list) ? list : [];
    cachedVendorNamesFetchedAt = now;
  } catch (e) {
    console.warn('getVendorNames failed:', e.message);
    cachedVendorNames = cachedVendorNames || [];
  }
  return cachedVendorNames;
}

function resolveVendorFromQuestion(question, vendorNames) {
  if (!question) return null;
  const q = String(question).toLowerCase();
  if (!Array.isArray(vendorNames) || vendorNames.length === 0) return null;
  let best = null;
  for (const rawName of vendorNames) {
    if (!rawName) continue;
    const name = String(rawName).trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (!lower || lower.length < 2) continue;
    if (q.includes(lower)) {
      if (!best || lower.length > best.toLowerCase().length) {
        best = name;
      }
    }
  }
  return best;
}

/**
 * GET /api/vendors
 * Returns list of component/vendor names from ReleaseTrain.
 */
app.get('/api/vendors', async (req, res) => {
  try {
    const r = await fetch(VENDORS_NAMES_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Vendors API error: ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.names ?? data?.data ?? []);
    return res.json(list);
  } catch (e) {
    console.error(e);
    return res.status(502).json([]);
  }
});

/**
 * GET /api/analytics/summary
 * In-memory analytics. Query: rangeDays=1|7|30, flow=all|os|patch, status=all|answer|abstain|error, vendor=text
 * KPI cards use the same filtered list as charts (period + vendor + flow + status).
 */
app.get('/api/analytics/summary', (req, res) => {
  const rangeDays = Math.min(90, Math.max(1, parseInt(String(req.query.rangeDays || req.query.range || '1'), 10) || 1));
  const flow = String(req.query.flow || 'all').toLowerCase();
  const status = String(req.query.status || 'all').toLowerCase();
  const vendor = String(req.query.vendor || '').trim();
  res.json({
    source: 'in-memory',
    summary: getAnalyticsSummaryQuery({ rangeDays, flow, status, vendor }),
  });
});

/**
 * GET /api/component?q=os
 * Proxies and shapes OS component data from ReleaseTrain.
 * Response: { main, versionNumber, additional: { versionReleaseNotes, versionProductLicense }, raw }
 */
app.get('/api/component', async (req, res) => {
  const q = (req.query.q || 'os').toLowerCase();
  try {
    if (q !== 'os') {
      return res.json({ error: 'Only q=os is supported', data: [] });
    }
    const components = await fetchOSComponents();
    const doc = findOSByProductAndDate(components, 'android', null);
    const formatted = formatOSResponse(doc);
    return res.json({ ...(formatted || {}), components });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: e.message, main: null, additional: {} });
  }
});

/**
 * GET /api/debug/trace?question=...&fetch=1
 * Shows how the question is parsed and which branch (patch vs OS) would run.
 * Add fetch=1 to call ReleaseTrain and include itemsCount / first doc tags (slow).
 */
app.get('/api/debug/trace', async (req, res) => {
  const rawQuestion = String(req.query.question || '').trim();
  const question = rawQuestion.toLowerCase();
  const parsedPatchVendor = parsePatchVendor(question);
  const dateStr = parseDateToYYYYMMDD(question);
  let branch = 'os';
  if (parsedPatchVendor && parsedPatchVendor !== 'linux') {
    branch = 'patch_non_linux → idk';
  } else if (parsedPatchVendor || (!question.includes('android') && question.includes('linux'))) {
    branch = 'patch_linux';
  }
  const trace = {
    rawQuestion: rawQuestion || null,
    normalizedQuestion: question || null,
    parsedPatchVendor: parsedPatchVendor || null,
    parsedDateYYYYMMDD: dateStr || null,
    branch,
    hints: {
      patchVendorRegex: '/patch\\s+for\\s+([^,.?]+?)(?=\\s+on\\s+|\\s*[.?]|\\s*$)/i',
      dateRegex: '(MM)-(DD)-(YYYY) or (MM)/(DD)/(YYYY) → YYYYMMDD',
    },
  };
  if (req.query.fetch === '1' && branch.startsWith('patch_linux')) {
    const vendor = parsedPatchVendor || 'linux';
    try {
      const items = await fetchPatchSearch(vendor);
      const searchUrl = `https://releasetrain.io/api/v/search?q=${encodeURIComponent(vendor)}&channel=patch&limit=25&page=1`;
      const doc = findLinuxPatchByDate(items, dateStr);
      trace.patchSearch = {
        searchUrl,
        vendor,
        itemsCount: items.length,
        firstItemTags: items[0]?.versionSearchTags ?? null,
        firstItemProductName: items[0]?.versionProductName ?? null,
        matchedDocHasVendor: doc ? docHasVendor(doc, vendor) : null,
        matchedDocTags: doc?.versionSearchTags ?? null,
      };
    } catch (e) {
      trace.patchSearch = { error: e.message };
    }
  } else if (req.query.fetch === '1' && branch === 'os') {
    try {
      const components = await fetchOSComponents();
      const product = question.includes('android')
        ? 'android'
        : question.includes('ios')
          ? 'ios'
          : question.includes('windows')
            ? 'windows'
            : 'android';
      const doc = findOSByProductAndDate(components, product, dateStr);
      trace.os = {
        componentsCount: components.length,
        product,
        matchedDocSummary: doc
          ? {
              versionProductName: doc.versionProductName,
              versionReleaseDate: doc.versionReleaseDate,
              versionSearchTags: doc.versionSearchTags ?? null,
            }
          : null,
      };
    } catch (e) {
      trace.os = { error: e.message };
    }
  }
  res.json(trace);
});

/**
 * Parse date from prompt (e.g. "02-14-2026" or "2-14-2026") to YYYYMMDD.
 * @returns {string|null} e.g. "20260214" or null
 */
function parseDateToYYYYMMDD(question) {
  const dateMatch = question.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (!dateMatch) return null;
  const [, m, d, y] = dateMatch;
  return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
}

const DONT_KNOW_ANSWER = "I don't know about the question you asked.";

/**
 * Parse vendor from "patch for X" / "patch for X on date" in the question.
 * @returns {string|null} e.g. "Roblox", "Linux", or null
 */
function parsePatchVendor(question) {
  const m = question.match(/patch\s+for\s+([^,.?]+?)(?=\s+on\s+|\s*[.?]|\s*$)/i);
  return m ? m[1].trim() : null;
}

function normalizeDateYYYYMMDD(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '').slice(0, 8);
}

function isVendorInNames(vendor, vendorNames) {
  const v = String(vendor || '').trim().toLowerCase();
  if (!v || !Array.isArray(vendorNames)) return false;
  return vendorNames.some((name) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return false;
    return n === v || n.includes(v) || v.includes(n);
  });
}

function findPatchDocInOSComponents(components, vendor, dateStr = null) {
  if (!Array.isArray(components) || components.length === 0) return null;
  const vendorNorm = String(vendor || '').trim().toLowerCase();
  const dateNorm = normalizeDateYYYYMMDD(dateStr);
  const candidates = components.filter((doc) => {
    const tags = Array.isArray(doc?.versionSearchTags)
      ? doc.versionSearchTags.map((t) => String(t).toLowerCase())
      : [];
    const name = String(doc?.versionProductName || '').toLowerCase();
    const brand = String(doc?.versionProductBrand || '').toLowerCase();
    const hasVendor = tags.some((t) => t === vendorNorm || t.includes(vendorNorm))
      || name === vendorNorm || name.includes(vendorNorm)
      || brand === vendorNorm || brand.includes(vendorNorm);
    const hasPatchTag = tags.includes('patch');
    return hasVendor && hasPatchTag;
  });
  if (candidates.length === 0) return null;
  if (dateNorm) {
    const dated = candidates.find((doc) => normalizeDateYYYYMMDD(doc?.versionReleaseDate) === dateNorm);
    if (dated) return dated;
  }
  const sorted = [...candidates].sort((a, b) => (b?.versionTimestamp || 0) - (a?.versionTimestamp || 0));
  return sorted[0] ?? null;
}

function findPatchByVendorAndDateFromTags(items, vendor, dateStr = null) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const vendorNorm = String(vendor || '').trim().toLowerCase();
  const dateNorm = normalizeDateYYYYMMDD(dateStr);
  const candidates = items.filter((doc) => {
    const tags = Array.isArray(doc?.versionSearchTags)
      ? doc.versionSearchTags.map((t) => String(t).toLowerCase())
      : [];
    if (tags.length === 0) return false;
    const firstTag = tags[0] || '';
    const hasPatchTag = tags.includes('patch');
    const vendorMatches = firstTag === vendorNorm || firstTag.includes(vendorNorm) || vendorNorm.includes(firstTag);
    return hasPatchTag && vendorMatches;
  });
  if (candidates.length === 0) return null;
  if (dateNorm) {
    const exactByTag = candidates.find((doc) => {
      const tags = Array.isArray(doc?.versionSearchTags)
        ? doc.versionSearchTags.map((t) => String(t))
        : [];
      return tags.includes(dateNorm);
    });
    if (exactByTag) return exactByTag;
    const exactByField = candidates.find((doc) => normalizeDateYYYYMMDD(doc?.versionReleaseDate) === dateNorm);
    if (exactByField) return exactByField;
  }
  const sorted = [...candidates].sort((a, b) => (b?.versionTimestamp || 0) - (a?.versionTimestamp || 0));
  return sorted[0] ?? null;
}

/**
 * 1 if the query matches a vendor/component name from ReleaseTrain /api/c/names, else 0 (for debug).
 */
function computeIsVendorFoundFlag(rawQuestion, vendorNames) {
  if (!rawQuestion || !Array.isArray(vendorNames) || vendorNames.length === 0) return 0;
  if (resolveVendorFromQuestion(rawQuestion, vendorNames)) return 1;
  const q = String(rawQuestion).toLowerCase();
  const pv = parsePatchVendor(q);
  if (pv) {
    const pvLower = pv.toLowerCase().trim();
    for (const rawName of vendorNames) {
      const nl = String(rawName).toLowerCase().trim();
      if (!nl) continue;
      if (nl === pvLower || nl.includes(pvLower) || pvLower.includes(nl)) return 1;
    }
  }
  return 0;
}

/**
 * True when the question looks like an OS/version lookup intent.
 * This prevents conversational/off-topic prompts from falling back to Android.
 */
function isOsVersionIntent(questionLower, resolvedVendor, parsedDateYYYYMMDD) {
  const q = String(questionLower || '');
  const hasVendor = Boolean(resolvedVendor);
  const hasDate = Boolean(parsedDateYYYYMMDD);
  const hasVersionKeyword = /(version|release|released|build|firmware|update|license|notes?)/i.test(q);
  const hasOsKeyword = /(operating system|\bos\b|android|ios|windows|linux|linux-dist|ubuntu|macos)/i.test(q);
  return hasVendor || hasDate || hasVersionKeyword || hasOsKeyword;
}

/**
 * POST /answer
 * Accepts { question } and returns main + additional from ReleaseTrain.
 * - Linux patch: "What is the patch for Linux on 02-14-2026?" → main = last of versionSearchTags, additional = versionUrl, versionReleaseNotes.
 * - OS/Android: "What is the version of OS Android on 02-14-2026?" → main = versionNumber, additional = versionReleaseNotes, versionProductLicense.
 */
app.post('/answer', async (req, res) => {
  const startedAt = Date.now();
  let analyticsFlow = 'os';
  let analyticsVendor = 'unknown';
  let isVendorFoundFlag = 0;
  const sendAnswer = (payload, code = 200) => {
    payload.isVendorFound = isVendorFoundFlag;
    payload._debugFormation = {
      ...(payload._debugFormation && typeof payload._debugFormation === 'object' ? payload._debugFormation : {}),
      isVendorFound: isVendorFoundFlag,
    };
    const status = code >= 500 ? 'error' : (payload?.status || 'unknown');
    let reason = payload?._debugFormation?.reason ?? null;
    if (!reason && status === 'abstain' && analyticsFlow === 'patch' && payload?._debugFormation?.step === 'fetchPatchSearch') {
      reason = 'patch_api_error';
    }
    if (!reason && status === 'abstain' && analyticsFlow === 'os') {
      reason = 'os_no_match';
    }
    if (!reason && status === 'answer') reason = 'answered';
    if (!reason && status === 'error') reason = 'server_error';
    try {
      recordAnalyticsEvent({
        status,
        flow: analyticsFlow,
        vendor: analyticsVendor,
        latencyMs: Date.now() - startedAt,
        reason,
        isVendorFound: isVendorFoundFlag,
      });
    } catch (analyticsErr) {
      console.warn('recordAnalyticsEvent:', analyticsErr?.message);
    }
    try {
      return code >= 400 ? res.status(code).json(payload) : res.json(payload);
    } catch (jsonErr) {
      console.error('sendAnswer JSON error:', jsonErr);
      if (!res.headersSent) {
        return res.status(500).json({ status: 'error', error: 'Response serialization failed', answer: '' });
      }
      return undefined;
    }
  };
  try {
    // Accept multiple possible field names for the user question to avoid
    // silently falling back to the default Android answer when the client
    // sends e.g. { prompt: "..." } instead of { question: "..." }.
    const rawQuestion = (
      req.body?.question ??
      req.body?.prompt ??
      req.body?.q ??
      ''
    ).trim();
    await pushLastPrompt(rawQuestion);
    const question = (rawQuestion || '').toLowerCase();

    const vendorNames = await getVendorNames();
    isVendorFoundFlag = computeIsVendorFoundFlag(rawQuestion, vendorNames);

    if (process.env.DEBUG) {
      console.log('[answer] question:', rawQuestion);
    }

    // Queries containing "Linux" are answered ONLY from the patch search API:
    // https://releasetrain.io/api/v/search?q=linux&channel=patch&limit=25&page=1
    // (never from the OS component API).
    // Patch flow: "patch for X [on date]" or any question that contains "linux".
    // - Only Linux patch is supported via ReleaseTrain today.
    // - If user asks for a patch for some other vendor (e.g. Roblox), we answer "I don't know about the question you asked."
    const parsedPatchVendor = parsePatchVendor(question);
    const isLinuxVendor = (v) => (v || '').toLowerCase().trim() === 'linux';
    if (parsedPatchVendor) {
      analyticsFlow = 'patch';
      analyticsVendor = parsedPatchVendor;
      if (!isVendorInNames(parsedPatchVendor, vendorNames)) {
        return sendAnswer({
          answer: DONT_KNOW_ANSWER,
          status: 'abstain',
          version: null,
          main: null,
          additional: {},
          vendor: parsedPatchVendor,
          source: 'ReleaseTrain',
          sourceUrl: VENDORS_NAMES_URL,
          versionSearchTags: null,
          _debugFormation: {
            step1_parsedInput: { rawQuestion, flow: 'patch', parsedVendor: parsedPatchVendor },
            reason: 'patch_vendor_not_in_names',
          },
        });
      }
      const dateStr = parseDateToYYYYMMDD(question);
      let patchItems;
      try {
        patchItems = await fetchPatchSearchAll();
      } catch (e) {
        return sendAnswer({
          answer: DONT_KNOW_ANSWER,
          status: 'abstain',
          version: null,
          main: null,
          additional: {},
          vendor: parsedPatchVendor,
          source: 'ReleaseTrain',
          sourceUrl: 'https://releasetrain.io/api/v/search?channel=patch&limit=25&page=1',
          versionSearchTags: null,
          _debugFormation: {
            step: 'fetchPatchSearchAll',
            error: e.message,
            reason: 'patch_api_error',
          },
        });
      }
      const patchDoc = findPatchByVendorAndDateFromTags(patchItems, parsedPatchVendor, dateStr);
      if (!patchDoc) {
        return sendAnswer({
          answer: DONT_KNOW_ANSWER,
          status: 'abstain',
          version: null,
          main: null,
          additional: {},
          vendor: parsedPatchVendor,
          source: 'ReleaseTrain',
          sourceUrl: 'https://releasetrain.io/api/v/search?channel=patch&limit=25&page=1',
          versionSearchTags: null,
          _debugFormation: {
            step1_parsedInput: { rawQuestion, flow: 'patch', parsedVendor: parsedPatchVendor, parsedDateYYYYMMDD: dateStr },
            step2_dataFetched: { sourceUrl: 'https://releasetrain.io/api/v/search?channel=patch&limit=25&page=1', itemsCount: patchItems?.length ?? 0 },
            reason: 'patch_not_found_in_search_tags',
          },
        });
      }
      const tags = Array.isArray(patchDoc.versionSearchTags) ? patchDoc.versionSearchTags : [];
      const main = patchDoc.versionNumber ?? (tags.length > 0 ? String(tags[tags.length - 1]) : 'N/A');
      return sendAnswer({
        answer: `Patch version: ${main}\n${patchDoc.versionUrl ? `URL: ${patchDoc.versionUrl}\n` : ''}Release notes: ${(patchDoc.versionReleaseNotes || 'N/A').slice(0, 200)}${(patchDoc.versionReleaseNotes || '').length > 200 ? '…' : ''}`,
        status: 'answer',
        version: main,
        main,
        additional: {
          versionReleaseNotes: patchDoc.versionReleaseNotes ?? null,
          versionProductLicense: null,
          versionUrl: patchDoc.versionUrl ?? null,
        },
        vendor: patchDoc.versionProductName ?? parsedPatchVendor,
        source: 'ReleaseTrain',
        sourceUrl: 'https://releasetrain.io/api/v/search?channel=patch&limit=25&page=1',
        versionSearchTags: tags,
        _debugFormation: {
          step1_parsedInput: { rawQuestion, flow: 'patch', parsedVendor: parsedPatchVendor, parsedDateYYYYMMDD: dateStr },
          step2_dataFetched: { sourceUrl: 'https://releasetrain.io/api/v/search?channel=patch&limit=25&page=1', itemsCount: patchItems?.length ?? 0 },
          step3_matchedDoc: {
            _id: patchDoc._id,
            versionId: patchDoc.versionId,
            versionReleaseDate: patchDoc.versionReleaseDate,
            versionSearchTags: patchDoc.versionSearchTags ?? null,
          },
        },
      });
    }

    // Use patch API only: when "patch for Linux" or when query contains "linux" (and not another patch vendor).
    const queryMentionsLinux = question.includes('linux');
    const patchVendor =
      (parsedPatchVendor && isLinuxVendor(parsedPatchVendor)) || (queryMentionsLinux && !question.includes('android'))
        ? 'linux'
        : parsedPatchVendor ?? null;
    if (patchVendor) {
      analyticsFlow = 'patch';
      analyticsVendor = patchVendor;
      const dateStr = parseDateToYYYYMMDD(question);
      // Linux patch queries are served only from this API (never from /api/component?q=os).
      const searchUrl = `https://releasetrain.io/api/v/search?q=${encodeURIComponent(patchVendor)}&channel=patch&limit=25&page=1`;
      let items;
      try {
        items = await fetchPatchSearch(patchVendor);
      } catch (e) {
        if (process.env.DEBUG) console.log('[answer] Patch search failed:', e.message);
        return sendAnswer({
          answer: DONT_KNOW_ANSWER,
          status: 'abstain',
          version: null,
          main: null,
          additional: {},
          vendor: patchVendor,
          source: 'ReleaseTrain',
          sourceUrl: searchUrl,
          versionSearchTags: null,
          _debugFormation: { step: 'fetchPatchSearch', error: e.message, reason: 'patch_api_error' },
        });
      }
      if (!items || items.length === 0) {
        return sendAnswer({
          answer: DONT_KNOW_ANSWER,
          status: 'abstain',
          version: null,
          main: null,
          additional: {},
          vendor: patchVendor,
          source: 'ReleaseTrain',
          sourceUrl: searchUrl,
          versionSearchTags: null,
          _debugFormation: {
            step1_parsedInput: { rawQuestion, flow: 'patch', parsedVendor: patchVendor, parsedDateYYYYMMDD: dateStr },
            step2_dataFetched: { sourceUrl: searchUrl, itemsCount: 0 },
            reason: 'no_results',
          },
        });
      }
      const doc = findLinuxPatchByDate(items, dateStr);
      if (!doc || !docHasVendor(doc, patchVendor)) {
        return sendAnswer({
          answer: DONT_KNOW_ANSWER,
          status: 'abstain',
          version: null,
          main: null,
          additional: {},
          vendor: patchVendor,
          source: 'ReleaseTrain',
          sourceUrl: searchUrl,
          versionSearchTags: doc?.versionSearchTags ?? null,
          _debugFormation: {
            step1_parsedInput: { rawQuestion, flow: 'patch', parsedVendor: patchVendor, parsedDateYYYYMMDD: dateStr },
            step2_dataFetched: { sourceUrl: searchUrl, itemsCount: items?.length ?? 0 },
            step3_matchedDoc: doc ? { _id: doc._id, versionSearchTags: doc.versionSearchTags } : null,
            reason: 'versionSearchTags_does_not_have_provided_vendor',
          },
        });
      }
      const formatted = formatLinuxPatchResponse(doc);
      const main = formatted?.main ?? 'N/A';
      const additional = formatted?.additional ?? {};
      const notes = additional.versionReleaseNotes || 'N/A';
      const url = additional.versionUrl || '';
      const versionSearchTags = Array.isArray(doc?.versionSearchTags)
        ? doc.versionSearchTags
        : Array.isArray(formatted?.raw?.versionSearchTags)
          ? formatted.raw.versionSearchTags
          : null;
      const payload = {
        answer: `Patch version: ${main}\n${url ? `URL: ${url}\n` : ''}Release notes: ${notes.slice(0, 200)}${notes.length > 200 ? '…' : ''}`,
        status: formatted ? 'answer' : 'abstain',
        version: main,
        main,
        additional: {
          versionReleaseNotes: additional.versionReleaseNotes,
          versionProductLicense: null,
          versionUrl: additional.versionUrl,
        },
        vendor: formatted?.raw?.versionProductName ?? patchVendor,
        source: 'ReleaseTrain',
        sourceUrl: searchUrl,
        versionSearchTags,
      };
      payload._debugFormation = {
        versionSearchTags: { value: versionSearchTags, fromDoc: doc?.versionSearchTags ?? null },
        step1_parsedInput: { rawQuestion, flow: 'patch', parsedVendor: patchVendor, parsedDateYYYYMMDD: dateStr },
        step2_dataFetched: { sourceUrl: searchUrl, itemsCount: items?.length ?? 0 },
        step3_matchedDoc: doc ? { _id: doc._id, versionSearchTags: doc.versionSearchTags } : null,
        step4_formatted: { main: formatted?.main ?? null },
      };
      if (process.env.DEBUG) console.log('[answer] Patch flow →', JSON.stringify(payload, null, 2));
      return sendAnswer(payload);
    }

    // OS flow: detect vendor from ReleaseTrain vendor names and match by date (or latest)
    const dateStr = parseDateToYYYYMMDD(question);
    const resolvedVendor = resolveVendorFromQuestion(rawQuestion, vendorNames);
    if (!isOsVersionIntent(question, resolvedVendor, dateStr)) {
      analyticsFlow = 'unknown';
      analyticsVendor = 'unknown';
      return sendAnswer({
        answer: DONT_KNOW_ANSWER,
        status: 'abstain',
        version: null,
        main: null,
        additional: {},
        vendor: 'Unknown',
        source: 'ReleaseTrain',
        sourceUrl: null,
        versionSearchTags: null,
        _debugFormation: {
          step1_parsedInput: { rawQuestion, normalizedQuestion: question, flow: 'unknown' },
          reason: 'unknown_intent_not_patch_or_os_version',
        },
      });
    }
    const components = await fetchOSComponents();
    const product = resolvedVendor ? resolvedVendor.toLowerCase() : 'android';
    analyticsFlow = 'os';
    analyticsVendor = resolvedVendor ?? product;
    const doc = findOSByProductAndDate(components, product, dateStr);
    const formatted = formatOSResponse(doc);
    const main = formatted?.versionNumber ?? formatted?.main ?? 'N/A';
    const additional = formatted?.additional ?? {};
    const answerText = formatted
      ? `Version: ${main}. Release notes: ${additional.versionReleaseNotes || 'N/A'}. License: ${additional.versionProductLicense || 'N/A'}.`
      : 'No matching release found for that product or date.';
    let versionSearchTags = Array.isArray(doc?.versionSearchTags)
      ? doc.versionSearchTags
      : Array.isArray(formatted?.raw?.versionSearchTags)
        ? formatted.raw.versionSearchTags
        : null;
    if (doc && versionSearchTags == null && typeof doc === 'object') {
      versionSearchTags = doc.version_search_tags ?? doc.versionSearchTags ?? null;
    }
    const payload = {
      answer: answerText,
      status: formatted ? 'answer' : 'abstain',
      version: main,
      main,
      additional: {
        versionReleaseNotes: additional.versionReleaseNotes,
        versionProductLicense: additional.versionProductLicense,
      },
      vendor: formatted?.raw?.versionProductName ?? 'Unknown',
      source: 'ReleaseTrain',
      versionSearchTags,
    };
    if (doc && versionSearchTags == null && typeof doc === 'object') {
      payload._debugDocKeys = Object.keys(doc);
    }
    payload._debugFormation = {
      ...(formatted ? {} : { reason: 'os_no_match' }),
      versionSearchTags: {
        value: versionSearchTags,
        source: doc?.versionSearchTags != null ? 'matchedDoc.versionSearchTags' : formatted?.raw?.versionSearchTags != null ? 'formatted.raw.versionSearchTags' : 'null',
        fromDoc: doc?.versionSearchTags ?? null,
        fromFormattedRaw: formatted?.raw?.versionSearchTags ?? null,
      },
      step1_parsedInput: {
        rawQuestion,
        normalizedQuestion: question,
        flow: 'os',
        parsedDateYYYYMMDD: dateStr ?? null,
        product,
      },
      step2_dataFetched: {
        sourceUrl: 'https://releasetrain.io/api/component?q=os',
        componentsCount: components?.length ?? 0,
      },
      step3_matchedDoc: doc
        ? {
            _id: doc._id,
            versionId: doc.versionId,
            versionReleaseDate: doc.versionReleaseDate,
            versionNumber: doc.versionNumber,
            versionProductName: doc.versionProductName,
            versionSearchTags: doc.versionSearchTags ?? null,
          }
        : null,
      step4_formatted: {
        main: formatted?.main ?? null,
        versionNumber: formatted?.versionNumber ?? null,
        additionalKeys: formatted?.additional ? Object.keys(formatted.additional) : [],
      },
      step5_finalResponse: {
        version: payload.version,
        main: payload.main,
        answerPreview: payload.answer?.slice(0, 80) + (payload.answer?.length > 80 ? '…' : ''),
      },
    };
    if (process.env.DEBUG) console.log('[answer] OS flow →', JSON.stringify(payload, null, 2));
    return sendAnswer(payload);
  } catch (e) {
    console.error(e);
    return sendAnswer({
      answer: '',
      status: 'error',
      error: e.message,
    }, 502);
  }
});

const PORT = process.env.PORT || 3000;
// Bind all interfaces (required for Docker, Render, Fly, Railway, etc.)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ReleaseHub API listening on 0.0.0.0:${PORT}`);
});
