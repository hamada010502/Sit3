# Deployment

Paylo runs as **one Node.js process** (`next start`) with a local SQLite file, plus a
small **webhook retry worker**. This page is what an operator needs to run it in
production. Architecture details are in `technical-addendum.md`.

## 1. Environment variables

Run `npm run check:env` on the server before every deploy (it reads `.env.production`, or
`.env`, then the process environment, and exits 1 on any error). Once the app is running,
**Admin → Operations → System health** shows the same checks live, from the server's own
environment, without ever showing values.

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | **yes** | Long random string (`openssl rand -hex 32`). Changing it logs everyone out. |
| `APP_URL` | **yes** | Public `https://` base URL. Used in every email/SMS/push link. |
| `DATABASE_PATH` | yes | Absolute path on a persistent disk, e.g. `/var/lib/paylo/paylo.db`. |
| `UPLOAD_DIR` | yes | Persistent directory for product/KYC images. Back it up with the DB. |
| `OWNER_EMAIL` | **yes** | The one owner identity (see `lib/owner.ts`). |
| `WEBHOOK_RETRY_SECRET` | **yes** | Shared by the app and the worker. Unset = retry endpoint disabled (501). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | strongly recommended | See §3. Both or neither. |
| `VAPID_SUBJECT` | recommended | `mailto:ops@your-domain`. Push services use it to contact you. |
| `EMAIL_TRANSPORT` + `SMTP_*`, `EMAIL_FROM` | for real email | `log` only records messages (Admin → Notifications). |
| `SMS_TRANSPORT`, `SMS_HTTP_URL`, `SMS_HTTP_TOKEN` | for real SMS | `http` needs both URL and token. |
| `WHATSAPP_TRANSPORT`, `WHATSAPP_HTTP_URL`, `WHATSAPP_HTTP_TOKEN` | for WhatsApp | Relay must map bodies onto approved templates (addendum §7b). |
| `LOGISTICS_WEBHOOK_SECRET` | if couriers push events | Unset = courier endpoint disabled. |
| `ANALYTICS_REFRESH_SECRET` | optional | Only for a scheduled analytics refresh. |
| `PAYMENT_CARD_ENABLED`, `PAYMENT_PROVIDER` | leave `0` / `mock` | Card stays off until the bank contract (v2 §3). |

`NODE_ENV=production` is set by `next start`.

## 2. Webhook retry worker

Failed webhook deliveries are retried at 1 m, 5 m, 30 m, 2 h and 6 h, then marked **dead**.
Nothing retries unless something calls `POST /api/internal/webhooks/retry` with header
`x-worker-secret: $WEBHOOK_RETRY_SECRET` **every 60 seconds**. Pick one:

**systemd (recommended)** — runs the bundled worker and restarts it if it dies:

```ini
# /etc/systemd/system/paylo-webhook-worker.service
[Unit]
Description=Paylo webhook retry worker
After=paylo.service

[Service]
WorkingDirectory=/srv/paylo
EnvironmentFile=/srv/paylo/.env.production
ExecStart=/usr/bin/node scripts/webhook-worker.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now paylo-webhook-worker`. Logs: `journalctl -u paylo-webhook-worker`.
A wrong or missing secret is logged on every tick as `retry endpoint answered HTTP 401/501`.

**cron** — if you prefer no long-running process:

```cron
* * * * * curl -fsS -X POST -H "x-worker-secret: $WEBHOOK_RETRY_SECRET" https://your-domain/api/internal/webhooks/retry >/dev/null
```

Running two workers at once is safe: each delivery is claimed with a conditional update.

**How you know it is running:** each call stores a heartbeat. Admin → Operations shows
"Worker last called in" and turns the *Webhook retry worker* health row red after 5 minutes
of silence; the *Webhooks retrying* tile turns red with an "overdue" count when retries are
due but nobody is processing them. Dead-letter deliveries are listed there too.

## 3. VAPID keys (Web Push)

- **Generate once:** `npx web-push generate-vapid-keys`, put both in the environment.
- **If unset,** the app generates a pair on first use and stores it in the `settings` table.
  That works, but the keys then live only in the database: restoring an old backup or
  resetting the DB silently changes them.
- **Rotation invalidates every subscription.** Browsers bind a subscription to the public
  key. After a rotation, existing devices get 401/403 from the push service; those failures
  are logged (Admin → Operations → Recent push failures). Sellers must re-enable "Alerts on
  this device" under Settings → Notifications. Rotate only if the private key leaked.
- **Stale devices** answer 404/410; the subscription is deleted automatically and the event
  is logged with *Removed = Yes*. Any other failure (network, 5xx, 401/403) is logged and
  the subscription kept.

## 4. Backups (SQLite)

The database runs in WAL mode, so **do not copy the `.db` file with `cp` while the app is
running** — you can get a torn copy. Use SQLite's online backup:

```bash
# nightly, e.g. 02:30
sqlite3 /var/lib/paylo/paylo.db ".backup '/var/backups/paylo/paylo-$(date +%F).db'"
tar -czf /var/backups/paylo/uploads-$(date +%F).tgz -C /var/lib/paylo uploads
find /var/backups/paylo -mtime +30 -delete
```

- Copy backups **off the server** (object storage or another host) daily.
- Keep 30 daily copies; the audit log and money ledger make this a financial record.
- **Test a restore monthly:** copy a backup to a scratch machine, point `DATABASE_PATH` at it,
  `next start`, and log in.
- After restoring, check Admin → Operations → System health; if VAPID keys were not set in
  the environment they are now the backup's keys (see §3).
- Optional: continuous replication with Litestream to object storage gives point-in-time
  recovery to within seconds.

## 5. SQLite limits and when to move to PostgreSQL

SQLite allows **one writer at a time** for the whole database. Every order placement,
status change, payout run and webhook log is a short write transaction; others wait
(better-sqlite3's default busy timeout is 5 s, after which the write fails with
`SQLITE_BUSY`). Reads are not blocked in WAL mode.

The migration is **forced** (not optional) when any of these is true:

1. **More than one app server is needed** — for availability (no downtime on a host
   failure) or for CPU. SQLite is a local file; two servers cannot share it safely. This is
   the most likely trigger.
2. **Any `SQLITE_BUSY` / "database is locked" error appears in production logs.** That
   means a write waited 5 s: users are already seeing failures.
3. **Sustained write load above ~50 write transactions per second at peak** [estimate — each
   Paylo write is a few ms on SSD; measure your own p95 before relying on this number].
   In business terms that is far beyond checkout volume (hundreds of orders a minute);
   it would come from webhook/courier-event traffic or analytics, not from buyers.

Plan the migration (weeks, not days) when you reach **half** of trigger 3, or as soon as
a multi-server setup is on the roadmap. Until then SQLite is the correct choice for a
pilot (v2 §7.1). The migration itself is out of scope for now.

## 6. Production checklist

- [ ] `npm run check:env` passes on the server.
- [ ] `npm ci && npm run build`, then `next start` behind a TLS reverse proxy (HTTPS is
      required for the service worker and Web Push).
- [ ] `DATABASE_PATH` and `UPLOAD_DIR` on a persistent disk, owned by the app user.
- [ ] `npm run seed` run **once** on an empty DB; owner password changed at first login.
- [ ] Webhook worker running (§2) and "Worker last called in" is recent.
- [ ] Nightly backup + off-site copy (§4); one restore tested.
- [ ] Admin → Operations → System health shows no red rows.
- [ ] Owner and every admin have 2FA on.
- [ ] Send a test push from Seller → Settings → Notifications on a real phone.
- [ ] `PAYMENT_CARD_ENABLED=0` until the bank contract is signed.
