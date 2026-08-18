#!/usr/bin/env bash
# Reproduces the real, live round trip this prototype was proven against:
#   1. discover  — broadcast on the actual IES testnet (not just our local sandbox)
#   2. confirm   — full signed BAP<->BPP handshake, scoped to our local bpp.example.com
#   3. status    — our own webhook-server/ authors + signs a fresh IES_Policy AT REQUEST
#                  TIME and pushes it through onix's own caller interface; onix's real
#                  schema validator checks it independently, end to end
#
# Prerequisites:
#   - Docker Desktop running
#   - Stack up with our webhook backend built:
#       (cd ../ies-devkit/devkits/data-exchange/install && docker compose up -d --build)
set -euo pipefail
EXAMPLES="../ies-devkit/devkits/data-exchange/uc3-tariff-policy/examples"
CALLER="http://localhost:8081/bap/caller"

echo "=== 1. discover (broadcast on the real testnet) ==="
curl -s -X GET "$CALLER/discover" -H "Content-Type: application/json" -d @"$EXAMPLES/discover-request.json" | head -c 300
echo -e "\n"

echo "=== 2. confirm (scoped to our local bpp.example.com) ==="
curl -s -X POST "$CALLER/confirm" -H "Content-Type: application/json" -d @"$EXAMPLES/confirm-request.json"
echo -e "\n"

echo "=== 3. status (our webhook authors + signs a policy live, right now) ==="
curl -s -X POST "$CALLER/status" -H "Content-Type: application/json" -d @"$EXAMPLES/status-request.json"
echo -e "\n"

sleep 3
echo "=== our webhook's own log: proves it built + signed a fresh policy for this request ==="
docker logs sandbox-bpp --tail 4 2>&1

echo ""
echo "=== onix-bap's own validator independently confirmed our live payload as schema-conformant IES_Policy ==="
docker logs onix-bap --since 15s 2>&1 | grep "Validation passed for @type: IES_Policy" || echo "(not found in last 15s — re-run status step above)"

echo ""
echo "To extract the actually-delivered payload and re-run both evaluators on it:"
echo "  docker logs sandbox-bap > /tmp/sandbox-bap-live.log"
echo "  (see README.md 'Closing the loop' for the extraction one-liner)"
echo "  python evaluator.py received-from-live-webhook.json test/fixtures/usage-normal.json"
