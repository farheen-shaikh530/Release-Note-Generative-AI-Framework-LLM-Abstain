import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS releases (
    id SERIAL PRIMARY KEY,
    version_search_tags_key TEXT UNIQUE NOT NULL,
    version_product_name TEXT,
    version_product_brand TEXT,
    version_release_date TEXT,
    version_release_channel TEXT,
    version_timestamp_last_update BIGINT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_releases_vendor
    ON releases (LOWER(version_product_name), LOWER(version_product_brand));
  CREATE INDEX IF NOT EXISTS idx_releases_date
    ON releases (version_release_date);
  CREATE INDEX IF NOT EXISTS idx_releases_timestamp
    ON releases (version_timestamp_last_update DESC);
`;

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(INIT_SQL);
  } finally {
    client.release();
  }
}

export { pool };
