// NDPR / NDPA data minimisation: a daily job that strips or deletes personal
// data once it's no longer needed. Records that prove what happened (which
// document was verified, when, from which city, by which staff account) are
// kept; the identifying extras (IP, browser string, abandoned emails) are not.
//
// Periods are environment variables, in days. RETENTION_DISABLED=1 turns the
// job off. An advisory lock keeps two instances from running it at once.

const pool = require('../db/pool');

const days = (name, def) => Math.max(1, parseInt(process.env[name]) || def);
const LOCK_ID = 774411; // arbitrary, unique to this job

function rules() {
  return [
    {
      name: 'verification_log: verifier IP and browser',
      sql: `UPDATE verification_log SET ip_address = NULL, user_agent = NULL
            WHERE verified_at < NOW() - make_interval(days => $1)
              AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)`,
      params: [days('RETAIN_VERIFIER_IP_DAYS', 365)],
    },
    {
      name: 'activity_log: staff IP',
      sql: `UPDATE activity_log SET ip_address = NULL
            WHERE created_at < NOW() - make_interval(days => $1) AND ip_address IS NOT NULL`,
      params: [days('RETAIN_STAFF_IP_DAYS', 365)],
    },
    {
      name: 'demo_visitors: whole record',
      sql: `DELETE FROM demo_visitors WHERE COALESCE(last_seen_at, first_seen_at) < NOW() - make_interval(days => $1)`,
      params: [days('RETAIN_DEMO_VISITOR_DAYS', 730)],
    },
    {
      name: 'verification_payments: email on unpaid attempts',
      sql: `UPDATE verification_payments SET payer_email = NULL
            WHERE paystack_status <> 'success' AND payer_email IS NOT NULL
              AND created_at < NOW() - make_interval(days => $1)`,
      params: [days('RETAIN_UNPAID_EMAIL_DAYS', 90)],
    },
    {
      name: 'batches: stale drafts cancelled',
      sql: `UPDATE batches SET status = 'cancelled', decided_at = NOW(), decision_note = 'Expired: never submitted'
            WHERE status = 'draft' AND created_at < NOW() - make_interval(days => $1)`,
      params: [days('RETAIN_BATCH_ROWS_DAYS', 90)],
    },
    {
      // Names and matric numbers of rows that were never issued
      name: 'batch_rows: rows of rejected or cancelled batches',
      sql: `DELETE FROM batch_rows br USING batches b
            WHERE br.batch_id = b.id AND b.status IN ('rejected', 'cancelled')
              AND COALESCE(b.decided_at, b.created_at) < NOW() - make_interval(days => $1)`,
      params: [days('RETAIN_BATCH_ROWS_DAYS', 90)],
    },
    {
      // Uploaded student-list records only exist to check who documents go to
      name: 'student_records: issued or stale uploaded list entries',
      sql: `DELETE FROM student_records
            WHERE (issued_at IS NOT NULL AND issued_at < NOW() - make_interval(days => $1))
               OR created_at < NOW() - make_interval(days => $2)`,
      params: [days('RETAIN_STUDENT_LIST_ISSUED_DAYS', 30), days('RETAIN_STUDENT_LIST_DAYS', 180)],
    },
  ];
}

async function runRetention(log = console) {
  const client = await pool.connect();
  const out = {};
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!lock.rows[0].ok) return { skipped: 'another instance is running it' };
    try {
      for (const r of rules()) {
        try {
          const res = await client.query(r.sql, r.params);
          out[r.name] = res.rowCount;
        } catch (e) {
          // A table that doesn't exist yet (migration not run) is not an error here
          out[r.name] = e.code === '42P01' || e.code === '42703' ? 'n/a' : 'error: ' + e.message;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } finally {
    client.release();
  }
  const touched = Object.entries(out).filter(([, v]) => v !== 0 && v !== 'n/a');
  if (touched.length) log.log('Retention:', JSON.stringify(Object.fromEntries(touched)));
  return out;
}

// First run a minute after start (let the server settle), then every 24 hours
function scheduleRetention() {
  if (process.env.RETENTION_DISABLED === '1') return;
  const go = () => runRetention().catch(e => console.error('Retention job failed:', e.message));
  setTimeout(go, 60 * 1000).unref();
  setInterval(go, 24 * 60 * 60 * 1000).unref();
}

module.exports = { runRetention, scheduleRetention, rules };
