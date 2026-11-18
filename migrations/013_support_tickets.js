// migrations/013_support_tickets.js
// Run once: node migrations/013_support_tickets.js
// Support tickets: school staff open a ticket from the Support menu in /app;
// Innovation Lens answers from the Support tab in /admin. Each ticket is a
// thread of messages. Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SEQUENCE IF NOT EXISTS support_ticket_no START 1001;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_no     INTEGER NOT NULL UNIQUE DEFAULT nextval('support_ticket_no'),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        created_by    UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        category      VARCHAR(20) NOT NULL
                        CHECK (category IN ('technical', 'documents', 'account', 'billing', 'other')),
        priority      VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
        subject       VARCHAR(150) NOT NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'answered', 'resolved', 'closed')),
        page          VARCHAR(200),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at   TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS support_tickets_tenant ON support_tickets (tenant_id, updated_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS support_tickets_status ON support_tickets (status, updated_at DESC);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id    UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author_kind  VARCHAR(10) NOT NULL CHECK (author_kind IN ('school', 'support')),
        author_id    UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        author_name  VARCHAR(255) NOT NULL,
        body         TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS support_messages_ticket ON support_messages (ticket_id, created_at);`);
    console.log('✓ support_tickets, support_messages');

    await client.query('COMMIT');
    console.log('Migration 013 complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration 013 failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
run();
