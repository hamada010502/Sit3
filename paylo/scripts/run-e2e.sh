#!/usr/bin/env bash
# Runs e2e suites, each against a freshly seeded DB and a fresh server.
# Usage: scripts/run-e2e.sh [--no-build] [suite ...]   (default: all suites)
set -u
cd "$(dirname "$0")/.."
BUILD=1
if [ "${1:-}" = "--no-build" ]; then BUILD=0; shift; fi
SUITES=("$@")
[ ${#SUITES[@]} -eq 0 ] && SUITES=(smoke registration-tests account-checkout-tests parity-tests sprint-tests)

export LOGISTICS_WEBHOOK_SECRET="${LOGISTICS_WEBHOOK_SECRET:-dev-logistics-secret}"
export WEBHOOK_RETRY_SECRET="${WEBHOOK_RETRY_SECRET:-dev-retry-secret}"
# Bracketed patterns so pkill never matches a shell whose command line merely mentions them.
stop() { pkill -f "next-serve[r]" 2>/dev/null; pkill -f "next star[t]" 2>/dev/null; sleep 1; }
stop
if [ $BUILD = 1 ]; then npx next build > /tmp/paylo-build.log 2>&1 || { tail -40 /tmp/paylo-build.log; exit 1; }; fi

FAIL=0
for s in "${SUITES[@]}"; do
  stop
  npm run db:reset > /dev/null 2>&1
  # parity-tests exercises real SMS/WhatsApp HTTP delivery against a local receiver.
  unset SMS_TRANSPORT SMS_HTTP_URL SMS_HTTP_TOKEN WHATSAPP_TRANSPORT WHATSAPP_HTTP_URL WHATSAPP_HTTP_TOKEN NODE_TLS_REJECT_UNAUTHORIZED
  if [ "$s" = parity-tests ] || [ "$s" = sprint-tests ]; then
    export SMS_TRANSPORT=http SMS_HTTP_URL=http://127.0.0.1:4011/sms SMS_HTTP_TOKEN=sms-test-token
    export WHATSAPP_TRANSPORT=http WHATSAPP_HTTP_URL=http://127.0.0.1:4011/wa WHATSAPP_HTTP_TOKEN=wa-test-token
  fi
  # sprint-tests stands in for the push service with a local HTTPS server on a self-signed
  # certificate; TEST ONLY — never set this outside the test harness.
  if [ "$s" = sprint-tests ]; then export NODE_TLS_REJECT_UNAUTHORIZED=0; fi
  (npx next start > "/tmp/paylo-$s.log" 2>&1 &)
  for _ in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/ && break; sleep 0.5; done
  echo "== $s"
  if ! node "e2e/$s.js" > "/tmp/paylo-$s.out" 2>&1; then FAIL=1; fi
  grep -E "ALL PASSED|FAILED|ASSERT" "/tmp/paylo-$s.out" || tail -15 "/tmp/paylo-$s.out"
done
stop
exit $FAIL
