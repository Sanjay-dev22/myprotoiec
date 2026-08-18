// Verifies a signed IES_Policy publication envelope the way a real BAP
// (a DISCOM billing system, an app, a meter) would: resolve the issuer's
// did:web document, extract its public key, and check the detached signature
// over the canonicalized policy object. Never trusts the envelope's `issuer`
// field blindly — the key used to verify comes from the DID document, not from
// the file being checked.
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalize } from "./canonicalize.js";

export function verifyEnvelope(envelope, didDocument) {
  if (didDocument.id !== envelope.publication.issuer) {
    return { valid: false, reason: `envelope claims issuer ${envelope.publication.issuer}, resolved DID is ${didDocument.id}` };
  }
  const vm = didDocument.verificationMethod.find(
    (v) => v.id === envelope.publication.proof.verificationMethod
  );
  if (!vm) {
    return { valid: false, reason: "verificationMethod not found in issuer's DID document" };
  }
  const publicKey = createPublicKey({ key: vm.publicKeyJwk, format: "jwk" });
  const canonicalBytes = Buffer.from(canonicalize(envelope.policy), "utf-8");
  const signature = Buffer.from(envelope.publication.proof.signatureValue, "base64");
  const valid = cryptoVerify(null, canonicalBytes, publicKey, signature);
  return valid ? { valid: true } : { valid: false, reason: "signature does not match resolved issuer key" };
}

// CLI entry point: `node src/verifyPolicy.js [file.json]`
// (path.resolve comparison, not a raw string/URL compare, so it works on
// Windows where process.argv[1] uses backslashes and import.meta.url doesn't)
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "")) {
  const POLICIES_DIR = new URL("../policies/", import.meta.url);
  const KEYS_DIR = new URL("../keys/", import.meta.url);
  const file = process.argv[2] ?? "mumbai-res-tariff.signed.json";
  const envelope = JSON.parse(readFileSync(new URL(file, POLICIES_DIR), "utf-8"));
  const did = JSON.parse(readFileSync(new URL("did.json", KEYS_DIR), "utf-8"));
  const result = verifyEnvelope(envelope, did);
  if (result.valid) {
    console.log(`PASS  ${envelope.policy.policyID} (${envelope.policy.id}) — signature verified against ${did.id}`);
  } else {
    console.error(`FAIL  ${envelope.policy.policyID} — ${result.reason}`);
    process.exit(1);
  }
}
