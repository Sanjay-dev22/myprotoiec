# Proposed extensions to `IES_Policy` (UC3 — Policy as Code / Tariff Intelligence)

Source of gaps: `ies-docs-raw/page_016.md` §8.4 ("Fields Not Present in the
Current Upstream Policy Object") and §11 ("Points for Confirmation"), plus one
additional gap found while implementing the billing evaluator (Open Item 4
below, not previously named in the docs). This document is written in the
shape the "Contribute to IES" process expects (`docs/propose-a-schema`):
problem, proposed shape, backward-compatibility argument.

## Open Item 1 — no issuer / signature field on `IES_Policy`

**Docs' own words:** *"No `issuer` field in `IES_Policy`... No W3C VC proof
block in `IES_Policy`... Verify the Beckn/catalogue or dataset-envelope
signature; do not insert an ungoverned proof field."*

**Proposal:** don't touch the core schema at all — wrap it in a **publication
envelope** that the issuer signs over:

```json
{
  "policy": { "...IES_Policy exactly as specified, unmodified...": true },
  "publication": {
    "issuer": "did:web:ies.merc.example",
    "issuedAt": "2026-04-01T06:00:00Z",
    "replaces": null,
    "currency": "INR",
    "proof": {
      "type": "Ed25519Signature2020",
      "verificationMethod": "did:web:ies.merc.example#key-1",
      "created": "2026-04-01T06:00:00Z",
      "proofPurpose": "assertionMethod",
      "signatureValue": "<base64, over the canonicalized `policy` object only>"
    }
  }
}
```

Implemented and tested in `src/authorPolicy.js` / `src/verifyPolicy.js`. The
signature covers `policy` only — never the envelope's own metadata — so
re-wrapping an already-published, unchanged policy (e.g. when a DISCOM
re-publishes a SERC's policy inline as part of a catalogue offer) never
invalidates the original signature.

## Open Item 2 — no currency field on `EnergySlab.price`

**Docs' own words:** *"No slab-level currency/unit field... The profile
assumes the authority's tariff context; a future schema should make currency
explicit."*

**Proposal:** a policy-level `currency` on the same publication envelope
(Open Item 1), not a per-slab field — tariffs don't mix currencies within one
policy, so one declaration per policy is sufficient and avoids repeating an
ISO 4217 code on every slab.

## Open Item 3 — no formal amendment / `replaces` convention

**Docs' own words:** *"Amendment convention — new `id`, same `policyID`,
explicit `replaces` link — to be formalised."*

**Proposal:** `publication.replaces` on the envelope, holding the prior
version's `id` (not `policyID`, which is unchanged across amendments already).
`null` for a first publication. This is additive metadata only — it changes
nothing about how `id`/`policyID` already work in the current schema.

## Open Item 4 — slab-to-time-of-day interaction order is unspecified (found during implementation, not previously named in the docs)

The schema defines `energySlabs[]` (progressive, applies to *total period
consumption*) and `surchargeTariffs[]` (time-of-day, applies to *consumption
within a recurring daily window*) as two independent arrays — but never states
**what rate a surcharge percentage is a percentage of**, when a customer's
usage spans multiple slabs. Two readings are both defensible:

- (a) apply the surcharge to the *marginal slab rate* each unit of energy
  actually fell into, or
- (b) apply the surcharge to the *blended average rate* across the whole
  billing period.

Two independently-built billing systems could both be "schema conformant" and
still disagree on the bill — which is precisely the failure mode Tariff
Intelligence exists to eliminate. `src/evaluator.js` and `evaluator.py`
implement and document reading (b) (see the header comment in
`src/evaluator.js`), and `test/run.js` proves both languages agree *given that
documented reading* — but the schema itself should state which reading is
authoritative. This is the single highest-value open item to raise: it is a
correctness ambiguity, not a missing convenience field.

## What we are NOT proposing

No change to any field inside `IES_Policy`, `EnergySlab`, or `SurchargeTariff`
themselves. Every fix here lives in a separate envelope or is a documentation
clarification — consistent with the docs' own instruction not to insert
ungoverned fields into the core object.
