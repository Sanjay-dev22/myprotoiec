# Contribute-to-IES submission package

**Do not submit this automatically — I haven't, and won't.** The actual
submission channel is a Google Form that requires your real name, organisation,
email, and phone number, and submitting it **automatically creates a public
GitHub issue** on `github.com/India-Energy-Stack/ies-accelerator` under your
name. That's a real, public, external action only you should take — this
document is everything drafted and ready so that submitting is a five-minute
copy/paste, not a rewrite.

**Where to submit:** https://forms.gle/ESVk4PDcfEerPo6f7
(linked from `ies.recindia.org.in/docs/propose-a-schema`)

**What happens after you submit:** a public tracking issue is created
automatically on the IES Accelerator GitHub repo with your proposal (schema,
use case, standards) — not your contact details, which stay private with the
IES secretariat. The community/secretariat reviews and discusses it there.

---

## Field-by-field, matched exactly to the live form

### 1. Name *(required)*
`— fill in —`

### 2. Organization *(required)*
`— fill in — (e.g. your name/independent, or a company name if you have one)`

### 3. Contact email *(required)*
`— fill in —`

### 4. Contact mobile number *(optional)*
`— fill in, or leave blank —`

### 5. Use case the proposed schema supports *(required)*

```
IES Use Case 3 — Policy as Code (draft/work-in-progress), specifically the
flagship "Tariff Intelligence" sub-use-case (policyType: TARIFF), as
documented at india-energy-stack.gitbook.io/docs/draft-work-in-progress/
tariff-intelligence.
```

### 6. Description and background *(required)*

```
We built and tested a working implementation of the UC3 (Policy as Code /
Tariff Intelligence) flow end to end: authored a real MERC-derived
residential tariff order as a schema-conformant IES_Policy object, signed
it, and served it live through a BPP webhook backend running against the
actual public devkit sandbox (onix-bap, onix-bpp, beckn-router, from
github.com/beckn/DEG). The payload was independently validated as
schema-conformant by ONIX's own validator ("Validation passed for @type:
IES_Policy at path: message.contract.performance[0].performanceAttributes.
dataPayload") and delivered end-to-end through a real signed Beckn
confirm -> status round trip, with the policy authored and signed fresh, at
request time, by our own code -- not a static fixture.

While building two independent billing evaluators (Node.js and Python)
against the published IES_Policy schema, we identified four concrete gaps
between what the schema currently defines and what a production billing
system needs in order to interoperate safely. Three are already flagged as
open in the docs (no issuer/proof field, no currency field, no formal
amendment convention); a fourth is not previously named anywhere we could
find: the interaction order between energySlabs and surchargeTariffs is
unspecified, meaning two independently-built, schema-conformant billing
systems could legitimately compute different bills from the identical
signed policy. We propose concrete, backward-compatible fixes for all four
(see the Schema field below), and have working reference code demonstrating
they resolve the ambiguity: both evaluators produce identical bills
(Rs2,428.98) from the same signed policy across four test scenarios,
including the specific edge cases the docs' own implementation checklist
names (open-ended top slab, a surcharge window that wraps past midnight,
and percentage vs. absolute-INR adjustments).
```

### 7. Schema *(required)*

```
We propose no change to the IES_Policy, EnergySlab, or SurchargeTariff
fields themselves. All four proposals below live in a separate PUBLICATION
ENVELOPE that wraps the unmodified IES_Policy object -- consistent with the
docs' own instruction not to insert ungoverned fields into the core schema.

  {
    "policy": { ...IES_Policy exactly as currently specified, untouched... },
    "publication": {
      "issuer": "did:web:<publisher-domain>",
      "issuedAt": "<ISO 8601 timestamp>",
      "replaces": null,
      "currency": "INR",
      "proof": {
        "type": "Ed25519Signature2020",
        "verificationMethod": "did:web:<publisher-domain>#key-1",
        "created": "<ISO 8601 timestamp>",
        "proofPurpose": "assertionMethod",
        "signatureValue": "<base64, signed over the canonicalized `policy` object only>"
      }
    }
  }

1) ISSUER / SIGNATURE (closes the documented gap: "No issuer field in
   IES_Policy... do not insert an ungoverned proof field"). The envelope's
   `publication.proof` carries a detached signature over the canonicalized
   `policy` object only -- never the envelope's own metadata -- so
   re-wrapping an already-published, unchanged policy (e.g. a DISCOM
   re-publishing a SERC policy inline in its own catalogue offer) never
   invalidates the original signature.

2) CURRENCY (closes: "No slab-level currency/unit field... a future schema
   should make currency explicit"). One `publication.currency` per policy,
   not a per-slab field -- a single tariff policy does not mix currencies,
   so one ISO 4217 declaration is sufficient and avoids repeating it on
   every slab.

3) AMENDMENT CONVENTION (closes: "Amendment convention -- new id, same
   policyID, explicit replaces link -- to be formalised"). We propose
   `publication.replaces`, holding the prior version's `id` (not
   `policyID`, which is already stable across amendments). `null` on first
   publication. Purely additive metadata -- changes nothing about how
   `id`/`policyID` already work.

4) NORMATIVE CLARIFICATION, not a new field -- the highest-value item:
   the schema defines `energySlabs[]` (progressive, applied to total
   period consumption) and `surchargeTariffs[]` (time-of-day, applied to
   consumption inside a recurring daily window) as independent arrays, but
   never states what rate a surcharge percentage is a percentage OF when a
   customer's usage spans multiple slabs. Two readings are both
   defensible: (a) the marginal slab rate each unit of energy actually fell
   into, or (b) the blended average rate across the whole billing period.
   Two "conformant" billing systems could disagree on a bill for the exact
   same signed policy -- the failure mode Tariff Intelligence exists to
   eliminate. We recommend the schema explicitly adopt and state one
   reading. Our reference implementation adopts and documents (b); working
   code proving two independent implementations agree given that reading is
   available on request / in the linked material below.
```

### 8. Standards the schema is based on *(optional)*

```
W3C DID Core (did:web); W3C Verifiable Credentials Data Model 2.0 (proof
structure pattern); Ed25519Signature2020; Beckn Protocol v2 (DatasetItem/1.1,
PriceSpecification/2.1, Payment/2.0 schemas, as already used elsewhere in
IES); ISO 8601 (recurrence/interval semantics -- unchanged from the upstream
IES_Policy); ISO 4217 (currency codes). Builds directly on, and proposes no
change to, the upstream IES_Policy / IES_Program / EnergySlab /
SurchargeTariff definitions at github.com/beckn/DEG (ies-specs branch,
specification/external/schema/ies/core/attributes.yaml).
```

### 9. Any additional material *(optional)*

```
Working reference implementation available: real MERC-derived tariff
authored and signed as IES_Policy; two independent billing evaluators
(Node.js, Python) proving byte-identical results across 4 test scenarios;
a live BPP webhook backend that authors and signs the policy fresh, at
request time, and was proven end-to-end against the public devkit sandbox
(github.com/beckn/DEG), with the payload independently validated by ONIX's
own schema validator. [ADD REPO LINK HERE IF PUBLISHED -- see note below]
```

### 10. GitHub username *(optional)*
`— fill in if you want to be tagged on the tracking issue, or leave blank —`

---

## Before you submit: one open decision

Field 9 is much stronger with a real, clickable link to the code than a
description alone — right now the prototype only exists locally in this
folder (`ies-prototype/`), not in a git repo, and not published anywhere.

If you want to include a link, the options are:

1. **Publish it publicly on GitHub** — the strongest option, since IES
   reviewers could actually run it. I can prepare a local git repo (`git
   init` + a first commit) as a safe, fully-local, reversible step — but
   actually creating a public GitHub repo and pushing needs your own GitHub
   account/authentication, and is a real public action I won't take without
   you explicitly asking for it.
2. **Submit without a link** — perfectly fine; the Schema and Description
   fields above are self-contained and don't depend on it. You'd lose the
   "here's proof it actually works" credibility boost, but nothing here
   requires a repo to make sense.
3. **Attach material another way** (e.g. paste key files' contents directly
   into the form, or offer to share the folder on request) if you'd rather
   not make it public yet.

Let me know which you'd like, and whether you want help with the local git
prep (option 1's first, safe half).
