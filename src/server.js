import express from 'express';
import {
  ingestMany,
  findRelease,
  getLatestFact,
  getFactOnDate,
  buildAnswerPayload
} from './dataLake.js';
import { parseQuestion } from './queryParser.js';
import { initDb } from './db.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

/**
 * Simple health check.
 */
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /facts/latest?vendor=<from_user>
 * vendor comes from user input query, passed by backend.
 */
app.get('/facts/latest', async (req, res) => {
  const vendor = req.query.vendor;
  if (!vendor) {
    return res.status(400).json({ error: 'query param vendor is required' });
  }
  const record = await getLatestFact(vendor);
  const payload = buildAnswerPayload(record);
  if (!payload) {
    return res.status(404).json({ error: 'No matching release found' });
  }
  res.json(payload);
});

/**
 * GET /facts/on-date?vendor=<from_user>&date=<from_user>
 * vendor and date come from user input, passed by backend.
 * date format: YYYY-MM-DD (e.g. 2026-02-27)
 */
app.get('/facts/on-date', async (req, res) => {
  const vendor = req.query.vendor;
  const date = req.query.date;
  if (!vendor) {
    return res.status(400).json({ error: 'query param vendor is required' });
  }
  if (!date) {
    return res.status(400).json({ error: 'query param date is required (YYYY-MM-DD)' });
  }
  const record = await getFactOnDate(vendor, date);
  const payload = buildAnswerPayload(record);
  if (!payload) {
    return res.status(404).json({ error: 'No matching release found for that vendor and date' });
  }
  res.json(payload);
});

/**
 * Endpoint to ingest raw records into the data lake.
 * Expects body: { records: [...] }
 */
app.post('/ingest', async (req, res) => {
  const { records } = req.body || {};
  await ingestMany(records || []);
  res.json({ stored: Array.isArray(records) ? records.length : 0 });
});

/**
 * Main endpoint:
 * Body: { question: string }
 * Response:
 * {
 *   mainData: "1.1.1",
 *   additionalInformation: {
 *     versionUrl: "...",
 *     versionReleaseNotes: "..."
 *   }
 * }
 */
app.post('/answer', async (req, res) => {
  const { question } = req.body || {};

  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  const parsed = parseQuestion(question);

  if (!parsed.productBrand && !parsed.productName) {
    return res.status(400).json({
      error: 'Could not understand product from question. Please include OS/vendor name.'
    });
  }

  await ensureDataForQuery(parsed);

  const record = await findRelease(parsed);
  const payload = buildAnswerPayload(record);

  if (!payload) {
    return res.status(404).json({ error: 'No matching release found' });
  }

  res.json(payload);
});

/**
 * Lazy-load data from ReleaseTrain for Linux/Android questions.
 */
async function ensureDataForQuery({ productName, channel }) {
  if (!productName) return;

  if (productName.toLowerCase() === 'linux') {
    const url =
      'https://releasetrain.io/api/v/search?q=linux&channel=patch&limit=25&page=1';
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const json = await resp.json();
      if (Array.isArray(json.data)) {
        await ingestMany(json.data);
      }
    } catch {
      // Ignore fetch errors
    }
  }
}

async function start() {
  try {
    await initDb();
    // eslint-disable-next-line no-console
    console.log('Database initialized');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Database init failed:', err.message);
    if (!process.env.DATABASE_URL) {
      // eslint-disable-next-line no-console
      console.warn('Set DATABASE_URL to use Postgres. Using in-memory fallback is not supported.');
    }
  }

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Patch answer service listening on http://localhost:${port}`);
  });
}

start();
