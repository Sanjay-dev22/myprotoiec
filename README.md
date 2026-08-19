# IES UC3 Prototype — Policy as Code / Tariff Intelligence

A working prototype for India Energy Stack's **Use Case 3: Policy as Code**
(flagship sub-use-case "Tariff Intelligence") — the one confirmed, via
`ies.recindia.org.in/docs`, to still be genuinely open/unproven ground (unlike
the 5 core use cases already built and demoed by 4 real DISCOMs in the
May–June 2026 "DISCOM Challenge").

**What it proves:** a real SERC tariff order, authored once as a signed
`IES_Policy` object, can be independently evaluated by two different billing
systems — written in two different languages — and produce byte-identical
bills. That is the exact claim the IES v0.4 Strategy Document makes about this
use case (§ A1.6): *"Multiple billing systems running the same Policy Pack
produce identical results."*

**Want to run this yourself?** See **[`GUIDE.md`](GUIDE.md)** for a
complete, from-scratch setup walkthrough — clone to first successful run in
about 10 minutes, PowerShell-first with a Bash alternative, no prior context
needed.

## What's real vs. simulated here

| Piece | Status |
|---|---|
| `IES_Policy` schema fields | **Real** — copied field-for-field from the official devkit example (`beckn/DEG`, `devkits/data-exchange/uc3-tariff-policy/examples/on-status-response-ready-inline.json`), derived from an actual MERC (Maharashtra) tariff order |
| Signing (Ed25519 over canonical JSON) | **Real crypto**, simulated identity — a locally-generated keypair standing in for a SERC's actual `did:web` key |
| `did:web` resolution | Simulated locally (`keys/did.json`) — real flow fetches `https://<issuer-domain>/.well-known/did.json` |
| Billing evaluator (Node + Python) | **Real logic**, our own documented interpretation (see `proposed-extensions.md`, Open Item 4 — the schema doesn't yet specify this) |
| Beckn envelope (discover/confirm/on_confirm/status) | **Wired up and proven live** against the real `beckn/DEG` sandbox stack (onix-bap, onix-bpp, beckn-router) running in Docker. See "Live sandbox round trip" below — this is no longer simulated. |

## Run it

```bash
npm run keygen   # generates keys/private.pem, keys/public.pem, keys/did.json
npm run author   # authors + signs policies/mumbai-res-tariff.signed.json
npm run verify   # verifies the signature by resolving keys/did.json
npm test         # runs 4 scenarios through Node AND Python evaluators, diffs them
```

Requires Python 3 on PATH (for `evaluator.py`) and Node.js 18+ (for native
`node:crypto` Ed25519 support).

## What the test proves, scenario by scenario

1. **Normal month** — 350 kWh spanning all three slabs, with usage inside
   both the evening-peak surcharge window and the night-offpeak discount
   window (the latter *wraps past midnight*, 23:00→05:00 — a specific edge
   case named in the docs' own implementation checklist, step 7).
2. **Boundary** — exactly 100 kWh, confirming slab allocation doesn't
   spill into slab 2 or off-by-one at the boundary.
3. **Open-ended top slab** — 1000 kWh, exercising `end: null` (the
   unbounded final tier), also named in the docs' checklist.
4. **Absolute vs. percentage adders** — a second test policy using
   `unit: INR_PER_KWH` instead of `PERCENT`, the third edge case the
   checklist names explicitly.

All four pass with Node and Python producing identical totals — using two
independently-written implementations (not a port of one into the other; see
`evaluator.py`'s docstring).

## How this maps to the real IES architecture

```
Today:      SERC ──► PDF ──► DISCOM-1/-2 billing, apps, meter firmware — each re-keys
This proto: SERC ──► signed IES_Policy (this repo's authorPolicy.js)
                          │
                          ▼
             two independent evaluators (evaluator.js, evaluator.py)
             read the SAME signed object and compute the SAME bill
```

- **Register** — `src/keygen.js` stands in for publishing a `did:web` document
  and registering in DeDi.
- **Discover / Exchange** — implemented and proven live against the real
  ONIX adapter (`webhook-server/`, see "Live sandbox round trip" below).
- **Credentials** — out of scope for UC3 (Policy as Code publishes openly,
  `accessMethod: INLINE`, settlement `0` — no W3C Verifiable Credential
  issuance involved, per the docs).

## Live sandbox round trip — a real webhook backend, not a swapped-in file

The real `beckn/DEG` devkit is cloned at `../ies-devkit`. Its `data-exchange`
sandbox stack (onix-bap, onix-bpp, beckn-router, redis, sandbox-bap,
sandbox-bpp — 7 containers) runs in Docker, and **the `sandbox-bpp` service
has been replaced with our own code** (`webhook-server/`, built by
`docker-compose.yml`'s `build:` block for that service) — not a static
fixture file. Bring it up with:

```bash
cd ../ies-devkit/devkits/data-exchange/install
docker compose up -d --build
```

**How the BPP side actually works now.** onix-bpp's routing config
(`config/local-simple-routing-BPPReceiver.yaml`) forwards every incoming
action to `http://sandbox-bpp:3002/api/webhook/<action>` — that hostname now
resolves to `webhook-server/server.js`. On a `status` call, it calls
`buildSignedPolicy()` from `src/policyEngine.js` — the exact function
`npm run author` uses — fresh, live, per request, then pushes the result back
into onix-bpp's own outbound interface (`POST http://onix-bpp:8082/bpp/caller/on_status`),
which signs and relays it onward. (Getting this right took a few iterations —
onix's real validator rejected our first two attempts for missing fields
[`commitments[].resources`, then `schema:temporalCoverage`] that weren't
obvious from the docs alone; the real example payload was the source of
truth for the fix.)

**Round trip, run via `./live-sandbox-roundtrip.sh`:**

1. **`discover`** — sent as a broadcast (no `bppId` filter, per the real
   example payload) against the actual live `nfh.global/testnet-deg` DeDi
   registry. Result: **it reached a real, currently-registered external
   participant** — `IntelliGrid AMI Services` (`bppId: fabric.nfh.global`,
   a live public endpoint at `https://34.93.165.42.sslip.io/beckn/`) — and
   returned a real AMI meter-data catalogue. This wasn't expected going in;
   it's direct proof the IES testnet is genuinely live right now, not just a
   local fixture.
2. **`confirm`** — scoped to our own local `bpp.example.com`. Full signed
   round trip: `onix-bap` → `beckn-router` → `onix-bpp` → our webhook →
   `on_confirm` pushed back through `onix-bpp`'s caller interface → router →
   `onix-bap` → `sandbox-bap` webhook. **Schema validation passed at every
   hop.**
3. **`status`** — same path. Our webhook builds and signs a brand-new
   `IES_Policy` object at the moment the request arrives (its
   `modificationDateTime` matches the request timestamp to the millisecond —
   proof it wasn't pre-generated). `onix-bap`'s own validator logged:
   **`Validation passed for @type: IES_Policy at path: message.contract.performance[0].performanceAttributes.dataPayload`**
   — the real ONIX schema validator, not our code, independently confirming
   our *live-generated* object conforms to the upstream `IES_Policy` schema.

**Closing the loop.** The payload `sandbox-bap` actually received (logged to
stdout, extracted from `docker logs sandbox-bap`) was pulled out and fed into
both evaluators exactly as delivered:

```bash
python evaluator.py received-from-live-webhook.json test/fixtures/usage-normal.json
```

**Rs2428.98** — identical to the standalone test result, now proven against a
policy that was authored, signed, and served entirely by our own running
code, validated independently by onix, and delivered correctly end to end.
Nothing in this path is a static file or a pre-computed answer.

## Files

- `src/keygen.js` — generates the publisher's signing identity
- `src/authorPolicy.js` — authors + signs the real MERC-derived tariff policy
- `src/verifyPolicy.js` — verifies a signed policy against its resolved DID
- `src/evaluator.js` — Node billing evaluator (documented method in the file header)
- `evaluator.py` — independent Python billing evaluator (same method, separate implementation)
- `src/canonicalize.js` — deterministic JSON serialization used for signing (shared logic, re-implemented identically in `evaluator.py`)
- `test/run.js` — runs both evaluators against 4 scenarios and diffs the results
- `test/fixtures/` — usage data + one alternate test policy (INR_PER_KWH surcharge)
- `proposed-extensions.md` — write-up of the 4 open schema gaps this prototype surfaces or resolves, formatted for the "Contribute to IES" process
- `policies/mumbai-res-tariff.signed.json` — generated output, the signed policy itself
- `keys/` — generated keypair + `did.json` (test identity only — never use `keys/private.pem` for anything but this prototype)
- `src/policyEngine.js` — shared author+sign logic, used by BOTH `authorPolicy.js` (CLI) and `webhook-server/server.js` (live) — one code path, not two
- `webhook-server/` — the real BPP backend that replaced the devkit's fixture-serving `sandbox-bpp`; builds and signs a fresh policy on every `status` request
- `live-sandbox-roundtrip.sh` — reproduces the discover/confirm/status round trip against the running Docker sandbox
- `received-from-live-webhook.json` — the actual `IES_Policy` payload as received by `sandbox-bap`, generated live by `webhook-server/` and delivered through the full signed round trip

## Stopping the sandbox

```bash
cd ../ies-devkit/devkits/data-exchange/install
docker compose down
```
