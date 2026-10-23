#!/usr/bin/env bash
# Local end-to-end check: mock xAI upstream + `wrangler dev` (local KV simulator). No real key or cost.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
node test/mock-upstream.mjs & MOCK=$!
npx wrangler dev --local --port 8787 > /tmp/wrangler-dev.log 2>&1 & DEV=$!
trap 'kill $MOCK $DEV 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 1; done
O='Origin: http://localhost:5173'; D='X-Device-Id: 3f0b6a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
echo "status:  $(curl -s -H "$O" -H "$D" http://127.0.0.1:8787/status)"
echo "chat:    $(curl -s -H "$O" -H "$D" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}' http://127.0.0.1:8787/chat)"
echo "stream:  $(curl -sN -H "$O" -H "$D" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}],"stream":true}' http://127.0.0.1:8787/chat | tail -c 120 | tr '\n' ' ')"
echo "no-origin: $(curl -s -H "$D" http://127.0.0.1:8787/status)"
echo "owner:   $(curl -s -i -H "$O" -H "$D" -H 'X-Owner-Token: local-owner-token' http://127.0.0.1:8787/status | grep -i x-coach-remaining)"
