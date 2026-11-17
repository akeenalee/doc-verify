# Tests

End-to-end suites that drive a real server and a real PostgreSQL database through the same API the web app uses.

| Suite | Covers |
|---|---|
| `e2e.js` | Staff workspace: invites, TOTP, roles, issue, revoke, restore, reissue, verify pages, isolation between issuers |
| `e2e2.js` | Branding, logos, dated signatories, branded PDFs |
| `e2e3.js` | Bulk CSV issuing and approvals, 1,000-row upload |
| `e2e4.js` | QR signature v2, tamper checks, strict mode, key rotation, claim codes |
| `e2e5.js` | Print vendors and packs, disclosure, scan alerts |
| `e2e6.js` | Student records, SIS connector, test SIS |
| `e2e7.js` | Payments: webhook signature, each payment credited exactly once |
| `e2e8.js` | Account protection: holder PIN lockout, staff TOTP secrets encrypted and single-use codes |

## Running

**Never point these at production.** `reset.sql` deletes the `lasu` issuer's data before every suite. The runner refuses any database that isn't on your machine, and refuses the `DATABASE_URL` in `.env`.

You need a local PostgreSQL (or a throwaway Neon branch, with `ALLOW_REMOTE_TEST_DB=1`) and port 3000 free.

```bash
# once: create an empty database, then build the schema and the two test issuers
createdb uvtest
TEST_DATABASE_URL=postgres://postgres@localhost:5432/uvtest npm run test:setup

# every time
TEST_DATABASE_URL=postgres://postgres@localhost:5432/uvtest npm test

# one suite
TEST_DATABASE_URL=postgres://postgres@localhost:5432/uvtest npm test -- e2e7
```

The runner starts its own server for each suite with test-only secrets, so nothing in `.env` is used: no email goes out, Paystack is never called and the real signing key is never loaded. Server logs and downloaded files go to your temp folder (`univerify-tests`), or `TEST_OUT` if set. `e2e3` and `e2e5` need `unzip` on the path.

`schema.sql` is a schema-only dump. `--setup` loads it into an empty database, then runs every numbered migration, so new migrations are picked up without regenerating it.

## UI scripts

`ui4.js` to `ui6.js` drive the workspace in Chromium with Playwright and save screenshots to the temp folder. They expect a server already running on :3000 with the same environment the runner uses (`ADMIN_USER`, `ADMIN_PASS`, `TEST_DATABASE_URL`). They aren't part of `npm test`.
