// One-off: apply Finpist sync migrations 336/337/338 to Campion production DB.
// Reads DB password from VaultMate. Records each migration in
// supabase_migrations.schema_migrations so the CLI tracking stays consistent.
//
// Run from S:/Project Management/vaultmate where pg is installed.
//   node apply-finpist-migrations.js

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { Client } = require('pg')

const PROJECT_REF = 'sluvkryxultbonhygisd'
const MIGRATIONS_DIR = 'S:/My Projects/Campion/supabase/migrations'
const TARGETS = [
  { version: '336', name: 'finpist_sync_foundation' },
  { version: '337', name: 'finpist_sync_rls' },
  { version: '338', name: 'finpist_sync_triggers' },
  { version: '339', name: 'finpist_sync_gst_returns' },
  { version: '340', name: 'finpist_sync_insert_triggers' },
]

function getDbPassword() {
  const db = new Database(process.env.APPDATA + '/vaultmate/vaultmate.db', { readonly: true })
  const row = db
    .prepare(
      `SELECT c.secret FROM credentials c JOIN projects p ON c.project_id = p.id
       WHERE p.name = 'Campion' AND c.title = 'Supabase Database Password'`,
    )
    .get()
  db.close()
  if (!row || !row.secret) throw new Error('DB password not found in VaultMate')
  return row.secret
}

function readMigration(version, name) {
  const file = path.join(MIGRATIONS_DIR, `${version}_${name}.sql`)
  if (!fs.existsSync(file)) throw new Error(`Migration file not found: ${file}`)
  return fs.readFileSync(file, 'utf8')
}

async function main() {
  const password = getDbPassword()

  // Direct connection (port 5432). Pooler at 6543 doesn't allow DDL transactions cleanly.
  const client = new Client({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  })

  console.log(`Connecting to db.${PROJECT_REF}.supabase.co...`)
  await client.connect()
  console.log('Connected.\n')

  // Check which target migrations already exist in schema_migrations
  const existing = await client.query(
    `SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1)`,
    [TARGETS.map((t) => t.version)],
  )
  const existingSet = new Set(existing.rows.map((r) => r.version))
  console.log(`Already applied: ${[...existingSet].join(', ') || '(none)'}\n`)

  for (const target of TARGETS) {
    if (existingSet.has(target.version)) {
      console.log(`SKIP  ${target.version}_${target.name} — already in schema_migrations`)
      continue
    }

    const sql = readMigration(target.version, target.name)
    console.log(`APPLY ${target.version}_${target.name} (${sql.length} chars)`)

    try {
      await client.query('BEGIN')
      await client.query(sql)
      // Record in schema_migrations so CLI tracking stays consistent.
      // Statements column is text[]; we store the raw SQL split heuristically.
      const statements = sql
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
         VALUES($1, $2, $3)
         ON CONFLICT (version) DO NOTHING`,
        [target.version, target.name, statements],
      )
      await client.query('COMMIT')
      console.log(`  ✓ committed\n`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error(`  ✗ FAILED: ${err.message}`)
      if (err.position) console.error(`    at position ${err.position}`)
      console.error('  Aborting — fix this migration and re-run.')
      await client.end()
      process.exit(1)
    }
  }

  // Verification
  console.log('Verification:')
  const v = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.columns WHERE column_name = 'is_client_visible'
          AND table_name IN ('tasks','gst_filings','tds_returns','itr_returns','tax_notices','notice_responses')) AS visibility_cols,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'client_activity_feed') AS feed_table,
       (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name LIKE '%client_activity%') AS triggers,
       (SELECT COUNT(*) FROM client_activity_feed) AS feed_rows`,
  )
  console.log(JSON.stringify(v.rows[0], null, 2))

  await client.end()
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
