import { pool } from './db.js';
import * as cache from './cache.js';

function extractFields(raw) {
  const tags = Array.isArray(raw.versionSearchTags) ? raw.versionSearchTags : [];
  const key = JSON.stringify(tags);
  const name = String(raw.versionProductName || '');
  const brand = String(raw.versionProductBrand || '');
  const date = String(raw.versionReleaseDate || '');
  const channel = String(raw.versionReleaseChannel || '');
  const ts = raw.versionTimestampLastUpdate
    ? parseInt(raw.versionTimestampLastUpdate, 10)
    : raw.versionTimestamp
    ? parseInt(raw.versionTimestamp, 10)
    : 0;
  return { key, name, brand, date, channel, ts, raw };
}

/**
 * Ingest a raw release record from ReleaseTrain API into the data lake.
 * Keyed by JSON stringified versionSearchTags.
 */
export async function ingestRecord(raw) {
  if (!raw || !Array.isArray(raw.versionSearchTags)) return;
  const { key, name, brand, date, channel, ts, raw: data } = extractFields(raw);
  await pool.query(
    `INSERT INTO releases (
      version_search_tags_key, version_product_name, version_product_brand,
      version_release_date, version_release_channel, version_timestamp_last_update, data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (version_search_tags_key) DO UPDATE SET
      version_product_name = EXCLUDED.version_product_name,
      version_product_brand = EXCLUDED.version_product_brand,
      version_release_date = EXCLUDED.version_release_date,
      version_release_channel = EXCLUDED.version_release_channel,
      version_timestamp_last_update = EXCLUDED.version_timestamp_last_update,
      data = EXCLUDED.data`,
    [key, name, brand, date, channel, ts, JSON.stringify(data)]
  );
}

/**
 * Bulk ingest an array of raw records.
 * Invalidates cache for affected vendors so next lookup is fresh.
 */
export async function ingestMany(records) {
  if (!Array.isArray(records)) return;
  const vendors = new Set();
  for (const r of records) {
    await ingestRecord(r);
    const v = (r?.versionProductName || r?.versionProductBrand || '').toString().toLowerCase();
    if (v) vendors.add(v);
  }
  for (const v of vendors) {
    await cache.del(`fact:latest:${v}`);
  }
}

/**
 * Query by simple filters (brand / name / date / channel).
 */
export async function findRelease({ productBrand, productName, releaseDate, channel }) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (productBrand) {
    conditions.push(`(LOWER(version_product_brand) = LOWER($${i}) OR LOWER(version_product_name) = LOWER($${i}))`);
    params.push(productBrand);
    i++;
  }
  if (productName) {
    conditions.push(`(LOWER(version_product_name) = LOWER($${i}) OR LOWER(version_product_brand) = LOWER($${i}))`);
    params.push(productName);
    i++;
  }
  if (releaseDate) {
    conditions.push(`version_release_date = $${i}`);
    params.push(releaseDate);
    i++;
  }
  if (channel) {
    conditions.push(`LOWER(version_release_channel) = LOWER($${i})`);
    params.push(channel);
    i++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT data FROM releases ${where} ORDER BY version_timestamp_last_update DESC LIMIT 1`,
    params
  );
  const row = res.rows[0];
  return row ? row.data : null;
}

/**
 * Get latest fact for a vendor (from user input).
 * vendor: e.g. "android", "linux" – matched against versionProductName/versionProductBrand.
 * Uses Redis cache when REDIS_HOST is set (5 min TTL).
 */
export async function getLatestFact(vendor) {
  if (!vendor || typeof vendor !== 'string') return null;
  const cacheKey = `fact:latest:${vendor.trim().toLowerCase()}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const res = await pool.query(
    `SELECT data FROM releases
     WHERE LOWER(version_product_name) = LOWER($1) OR LOWER(version_product_brand) = LOWER($1)
     ORDER BY version_timestamp_last_update DESC NULLS LAST
     LIMIT 1`,
    [vendor.trim()]
  );
  const row = res.rows[0];
  const record = row ? row.data : null;
  if (record) await cache.set(cacheKey, record);
  return record;
}

/**
 * Get fact for a vendor on a specific date (from user input).
 * vendor: e.g. "android", "linux"
 * date: YYYY-MM-DD (e.g. "2026-02-27") – normalized to YYYYMMDD for DB.
 * Uses Redis cache when REDIS_HOST is set (10 min TTL for date-specific).
 */
export async function getFactOnDate(vendor, date) {
  if (!vendor || typeof vendor !== 'string') return null;
  // Normalize date: 2026-02-27 → 20260227
  const dateNorm = (date || '').replace(/-/g, '').replace(/\D/g, '');
  if (dateNorm.length !== 8) return null;

  const cacheKey = `fact:date:${vendor.trim().toLowerCase()}:${dateNorm}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const res = await pool.query(
    `SELECT data FROM releases
     WHERE (LOWER(version_product_name) = LOWER($1) OR LOWER(version_product_brand) = LOWER($1))
       AND version_release_date = $2
     ORDER BY version_timestamp_last_update DESC NULLS LAST
     LIMIT 1`,
    [vendor.trim(), dateNorm]
  );
  const row = res.rows[0];
  const record = row ? row.data : null;
  if (record) await cache.set(cacheKey, record, 600); // 10 min for date-specific
  return record;
}

/**
 * Helper to transform a record into the response shape.
 */
export function buildAnswerPayload(record) {
  if (!record) return null;
  const tags = Array.isArray(record.versionSearchTags) ? record.versionSearchTags : [];
  const mainData = tags.length ? tags[tags.length - 1] : record.versionNumber || null;

  return {
    mainData,
    additionalInformation: {
      versionUrl: record.versionUrl || null,
      versionReleaseNotes: record.versionReleaseNotes || null
    },
    raw: record
  };
}
