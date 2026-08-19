# Running This Prototype Locally — Setup Guide

This guide gets you from a fresh clone to a working, live round trip against
the real `beckn/DEG` sandbox network in about 10 minutes. No prior context
needed — if you just want to *run* this and see it work, start here. For the
*why* behind this prototype (the schema, the proposed fixes, the reasoning),
see `README.md` and `proposed-extensions.md`.

Commands below are given for **PowerShell** (Windows, no extra tools
required beyond Docker Desktop). A Bash equivalent is noted where it
differs, for macOS/Linux or Git Bash users.

## Prerequisites

- **Docker Desktop**, installed and running
- **Node.js 18+**
- **Python 3**
- **Git**

## 1. Clone both repositories, as siblings

This prototype depends on the real `beckn/DEG` devkit for the sandbox
network software. Clone both into the same parent folder:

```powershell
git clone https://github.com/beckn/DEG.git ies-devkit
git clone https://github.com/Sanjay-dev22/myprotoiec.git ies-prototype
```

You should now have `ies-devkit\` and `ies-prototype\` sitting next to each
other. The rest of this guide assumes that layout — if you rename or move
either folder, the relative paths in step 2 will need updating.

## 2. Apply the devkit patch

The stock `beckn/DEG` devkit ships a generic, fixture-serving stand-in for
the BPP side of the sandbox. This prototype replaces that stand-in with a
real backend that authors and signs a tariff object live. Rather than
hand-editing the devkit's `docker-compose.yml`, copy the already-patched
version shipped in this repo:

```powershell
Copy-Item ies-prototype\devkit-setup\docker-compose.yml `
  ies-devkit\devkits\data-exchange\install\docker-compose.yml -Force
```

```bash
# Bash equivalent
cp ies-prototype/devkit-setup/docker-compose.yml \
  ies-devkit/devkits/data-exchange/install/docker-compose.yml
```

## 3. Generate a local signing identity

The private key is intentionally not committed to this repo — generate your
own:

```powershell
cd ies-prototype
npm run keygen
npm run author
```

This creates `keys/private.pem`, `keys/public.pem`, `keys/did.json`, and
authors a signed sample policy at `policies/mumbai-res-tariff.signed.json`.

## 4. Start the sandbox

```powershell
cd ..\ies-devkit\devkits\data-exchange\install
docker compose up -d --build
```

First run pulls several base images and can take a few minutes. Confirm all
seven containers are healthy:

```powershell
docker ps
```

You should see: `redis-bap`, `redis-bpp`, `beckn-router`, `onix-bap`,
`onix-bpp`, `sandbox-bap`, and `sandbox-bpp` (the last one built from this
repo's `webhook-server/`, not the original `fidedocker/sandbox-2.0` image).

## 5. Run the round trip

```powershell
cd ..\..\..\..\ies-prototype
.\live-sandbox-roundtrip.ps1
```

```bash
# Bash equivalent (requires Git Bash or a Unix shell)
bash live-sandbox-roundtrip.sh
```

This fires `discover` → `confirm` → `status` against the live sandbox and
prints the results as it goes.

## Understanding the output

- **`discover`** broadcasts on the real, live `nfh.global/testnet-deg`
  network — it isn't scoped to our own sandbox, so it may reach real,
  independently-registered participants. The output is truncated by
  default; see the "Full discover output" note below to see it in full.
- **`confirm` / `status`** return an immediate `ACK` — the real answer is
  pushed back separately, through `onix-bpp`'s own outbound interface. Watch
  the `sandbox-bpp` container's own log (printed automatically by the
  script) for the `[live-author]` and `[emit]` lines — these show the
  backend building and signing a fresh policy object at that exact moment.
- **The final validator line** — `Validation passed for @type: IES_Policy`
  — comes from `onix-bap`'s own schema validator, not from any code in this
  repo. It's an independent confirmation that the live-generated object
  conforms to the official IES_Policy schema.

**Full `discover` output** (to see which participant responded, past the
truncated preview):
```powershell
curl.exe -s -X GET "http://localhost:8081/bap/caller/discover" `
  -H "Content-Type: application/json" `
  -d "@..\ies-devkit\devkits\data-exchange\uc3-tariff-policy\examples\discover-request.json" `
  | Out-File -Encoding utf8 discover-full.json
python -m json.tool discover-full.json
```
Look for the `provider.descriptor.name` field.

## Verifying the result independently

Extract exactly what was delivered over the network (not the locally
authored copy) and recompute the bill from it:

```powershell
docker logs sandbox-bap > sandbox-bap-live.log
# Then extract the dataPayload object from sandbox-bap-live.log into
# received-from-live-webhook.json (see extraction note in README.md),
# and run:
python evaluator.py received-from-live-webhook.json test/fixtures/usage-normal.json
```

Compare this against the standalone test suite's result:
```powershell
npm test
```
Both should report the same total (`2428.98`) — one computed from a locally
authored file, the other from data that actually traveled through the live
network.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker ps` shows nothing, or commands hang | Docker Desktop isn't running — start it and wait ~30s |
| `sandbox-bpp` still shows image `fidedocker/sandbox-2.0` | Step 2 wasn't applied, or applied to the wrong path — re-run the copy command, then `docker compose up -d --build` |
| A container shows `unhealthy` | `docker compose up -d` again; if it persists, `docker logs <container-name>` to see why |
| `discover` returns nothing / times out | Needs real internet access — some restricted networks (corporate VPNs, guest wifi) may block it |
| `bash: command not found` | Use the `.ps1` script instead — no Bash dependency required |
| Ports `8081`, `8082`, `9000`, `3001`, `3002` already in use | Another process is bound to one of those ports — stop it, or edit the port mappings in `docker-compose.yml` |

## Stopping the sandbox

```powershell
cd ies-devkit\devkits\data-exchange\install
docker compose down
```
