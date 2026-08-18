// Shared policy-authoring + signing logic, used by BOTH:
//   - src/authorPolicy.js (the CLI script, writes a file to disk)
//   - webhook-server/server.js (the live BPP webhook, builds + signs on
//     every incoming `status` request, from inside the running sandbox)
// Extracting this means the webhook server is running the SAME code path
// that produced the standalone artifact — not a copy, not a re-implementation.
import { sign } from "node:crypto";
import { canonicalize } from "./canonicalize.js";

// The IES_Policy object itself (schema-conformant, field-for-field matching
// the real devkit example — see authorPolicy.js header for provenance).
export function buildPolicy(now = new Date()) {
  return {
    "@context": "https://raw.githubusercontent.com/beckn/DEG/ies-specs/specification/external/schema/ies/core/context.jsonld",
    "@type": "IES_Policy",
    id: "policy-mumbai-res-001",
    objectType: "POLICY",
    createdDateTime: "2024-04-10T11:00:00Z",
    modificationDateTime: now.toISOString(), // reflects when THIS response was generated
    programID: "program-merashehar-001",
    policyID: "MUM-RES-T1",
    policyName: "Mumbai Residential Telescopic 2024",
    policyType: "TARIFF",
    samplingInterval: "R/2024-04-10T00:00:00Z/P1M",
    energySlabs: [
      { id: "slab-0-100", "@type": "EnergySlab", start: 0, end: 100, price: 4.5 },
      { id: "slab-101-300", "@type": "EnergySlab", start: 101, end: 300, price: 7.2 },
      { id: "slab-301-plus", "@type": "EnergySlab", start: 301, end: null, price: 9.8 }
    ],
    surchargeTariffs: [
      {
        id: "surcharge-evening-peak",
        "@type": "SurchargeTariff",
        recurrence: "P1D",
        interval: { start: "T18:00:00Z", duration: "PT4H" },
        value: 20,
        unit: "PERCENT"
      },
      {
        id: "discount-night-offpeak",
        "@type": "SurchargeTariff",
        recurrence: "P1D",
        interval: { start: "T23:00:00Z", duration: "PT6H" },
        value: -10,
        unit: "PERCENT"
      }
    ]
  };
}

// Signs `policy` with `privateKeyPem` and returns the full publication
// envelope (see proposed-extensions.md for why this shape, not a core-schema
// change, is how we address the "no issuer/proof field" gap).
export function signPolicy(policy, privateKeyPem, issuer, now = new Date()) {
  const canonicalBytes = Buffer.from(canonicalize(policy), "utf-8");
  const signature = sign(null, canonicalBytes, privateKeyPem);
  return {
    policy,
    publication: {
      issuer,
      issuedAt: now.toISOString(),
      replaces: null,
      currency: "INR",
      proof: {
        type: "Ed25519Signature2020",
        verificationMethod: `${issuer}#key-1`,
        created: now.toISOString(),
        proofPurpose: "assertionMethod",
        signatureValue: signature.toString("base64")
      }
    }
  };
}

export function buildSignedPolicy(privateKeyPem, issuer) {
  const now = new Date();
  const policy = buildPolicy(now);
  return signPolicy(policy, privateKeyPem, issuer, now);
}
