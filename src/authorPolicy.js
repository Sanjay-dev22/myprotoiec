// CLI: authors + signs the real MERC-derived tariff policy and writes it to
// disk. Uses policyEngine.js — the exact same code path the live webhook
// server (webhook-server/server.js) runs on every `status` request.
import { readFileSync, writeFileSync } from "node:fs";
import { buildSignedPolicy } from "./policyEngine.js";

const POLICIES_DIR = new URL("../policies/", import.meta.url);
const KEYS_DIR = new URL("../keys/", import.meta.url);

const privateKeyPem = readFileSync(new URL("private.pem", KEYS_DIR));
const publicationEnvelope = buildSignedPolicy(privateKeyPem, "did:web:ies.merc.example");

writeFileSync(
  new URL("mumbai-res-tariff.signed.json", POLICIES_DIR),
  JSON.stringify(publicationEnvelope, null, 2)
);

console.log("Authored + signed: policies/mumbai-res-tariff.signed.json");
console.log("  policyID:", publicationEnvelope.policy.policyID, " id:", publicationEnvelope.policy.id);
console.log("  issuer:  ", publicationEnvelope.publication.issuer);
