#!/usr/bin/env bash
# Runs e2e suites, each against a freshly seeded DB and a fresh server.
# Usage: scripts/run-e2e.sh [--no-build] [suite ...]   (default: all suites)
set -u
cd "$(dirname "$0")/.."
BUILD=1
if [ "${1:-}" = "--no-build" ]; then BUILD=0; shift; fi
SUITES=("$@")
[ ${#SUITES[@]} -eq 0 ] && SUITES=(smoke registration-tests account-checkout-tests parity-tests)

stop() { pkill -f "next-server" 2>/dev/null; pkill -f "next start" 2>/dev/null; sleep 1; }
stop
if [ $BUILD = 1 ]; then npx next build > /tmp/paylo-build.log 2>&1 || { tail -40 /tmp/paylo-build.log; exit 1; }; fi

FAIL=0
for s in "${SUITES[@]}"; do
  stop
  npm run db:reset > /dev/null 2>&1
  (npx next start > "/tmp/paylo-$s.log" 2>&1 &)
  for _ in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/ && break; sleep 0.5; done
  echo "== $s"
  if ! node "e2e/$s.js" > "/tmp/paylo-$s.out" 2>&1; then FAIL=1; fi
  grep -E "ALL PASSED|FAILED|ASSERT" "/tmp/paylo-$s.out" || tail -15 "/tmp/paylo-$s.out"
done
stop
exit $FAIL
