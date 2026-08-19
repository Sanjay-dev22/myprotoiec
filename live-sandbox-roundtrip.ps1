# PowerShell backup version of live-sandbox-roundtrip.sh — no Git Bash required.
# Only needs: Docker Desktop running, curl.exe (built into Windows 10/11), and
# the sandbox stack already up (docker compose up -d --build).
#
# Run from inside the ies-prototype folder:
#   powershell -ExecutionPolicy Bypass -File live-sandbox-roundtrip.ps1

$EXAMPLES = "..\ies-devkit\devkits\data-exchange\uc3-tariff-policy\examples"
$CALLER = "http://localhost:8081/bap/caller"

Write-Output "=== 1. discover (broadcast on the real testnet) ==="
curl.exe -s -X GET "$CALLER/discover" -H "Content-Type: application/json" -d "@$EXAMPLES\discover-request.json" | Out-File -Encoding utf8 discover-full.json
Get-Content discover-full.json -TotalCount 5
Write-Output "  (full response saved to discover-full.json -- run: python -m json.tool discover-full.json)"
Write-Output ""

Write-Output "=== 2. confirm (scoped to our local bpp.example.com) ==="
curl.exe -s -X POST "$CALLER/confirm" -H "Content-Type: application/json" -d "@$EXAMPLES\confirm-request.json"
Write-Output ""

Write-Output "=== 3. status (our webhook authors + signs a policy live, right now) ==="
curl.exe -s -X POST "$CALLER/status" -H "Content-Type: application/json" -d "@$EXAMPLES\status-request.json"
Write-Output ""

Start-Sleep -Seconds 3
Write-Output "=== our webhook's own log: proves it built + signed a fresh policy for this request ==="
docker logs sandbox-bpp --tail 4

Write-Output ""
Write-Output "=== onix-bap's own validator independently confirmed our live payload as schema-conformant IES_Policy ==="
$logs = docker logs onix-bap --since 15s 2>&1
$logs | Select-String "Validation passed for @type: IES_Policy"

Write-Output ""
Write-Output "To extract the actually-delivered payload and re-run both evaluators on it:"
Write-Output "  docker logs sandbox-bap > sandbox-bap-live.log"
Write-Output "  python evaluator.py received-from-live-webhook.json test/fixtures/usage-normal.json"
