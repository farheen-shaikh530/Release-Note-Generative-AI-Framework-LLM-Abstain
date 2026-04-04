import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createClient } from 'redis';

import {
  fetchOSComponents,
  findOSByProductAndDate,
  fetchPatchDetailsByVendorName,
  findPatchDetailsByVendorAndDate,
  formatPatchDetailsFromTags,
} from './releasetrain.js';

import { formatOSResponse } from './schema-os.js';

const app = express();

// ✅ Required for ES modules (__dirname fix)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Middleware
app.use(express.json());

// ✅ CORS (put BEFORE routes)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ======================
// ✅ HEALTH CHECK
// ======================
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'releasehub-api' });
});

// ======================
// 🔹 CONSTANTS
// ======================
const VENDORS_NAMES_URL = 'https://releasetrain.io/api/c/names';

// ======================
// 🔹 HELPERS
// ======================
async function safeFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function parseDateToYYYYMMDD(question) {
  if (!question) return null;

  let m = question.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const [, y, month, day] = m;
    return `${y}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
  }

  return null;
}

function parsePatchDetailsVendor(question) {
  const m = question.match(/patch\s+details\s+for\s+(.+?)(?=\s+on\s+|\s*\?$|\s*$)/i);
  return m ? m[1].trim() : null;
}

// ======================
// 🔹 ROUTES
// ======================

// Vendors API
app.get('/api/vendors', async (req, res) => {
  try {
    const data = await safeFetch(VENDORS_NAMES_URL);
    const list = Array.isArray(data) ? data : (data?.names ?? data?.data ?? []);
    res.json(list);
  } catch {
    res.json(['android', 'ios', 'windows', 'firefox', 'chrome']);
  }
});

// MAIN ANSWER API
app.post('/answer', async (req, res) => {
  try {
    const question = (req.body?.question || '').toLowerCase();

    const vendor = parsePatchDetailsVendor(question);
    const dateStr = parseDateToYYYYMMDD(question);

    // 🔹 PATCH FLOW
    if (vendor) {
      if (!dateStr) {
        return res.json({
          answer: "I don't know based on available verified data",
          status: 'abstain'
        });
      }

      const items = await fetchPatchDetailsByVendorName(vendor);
      const docs = findPatchDetailsByVendorAndDate(items, vendor, dateStr);

      if (!docs || docs.length === 0) {
        return res.json({
          answer: "I don't know based on available verified data",
          status: 'abstain'
        });
      }

      const formatted = docs.map(d => formatPatchDetailsFromTags(d));

      return res.json({
        answer: formatted.map((f, i) =>
          `#${i + 1}\nVersion: ${f.additional.versionNumber}\nNotes: ${f.additional.releaseNoteUrl}`
        ).join('\n\n'),
        status: 'answer'
      });
    }

    // 🔹 OS FLOW
    const components = await fetchOSComponents();
    const doc = findOSByProductAndDate(components, 'android', dateStr);
    const formatted = formatOSResponse(doc);

    return res.json({
      answer: formatted?.versionNumber || "I don't know",
      status: formatted ? 'answer' : 'abstain'
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ======================
// ✅ SERVE FRONTEND (LAST)
// ======================
const frontendDistPath = path.resolve(__dirname, '../frontend/dist');

app.use(express.static(frontendDistPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// ======================
// ✅ START SERVER (LAST)
// ======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
   console.log(`ReleaseHub running on ${PORT}`);

});