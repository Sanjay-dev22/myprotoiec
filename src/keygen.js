// Generates an Ed25519 keypair standing in for a publisher's did:web signing key.
// Real IES onboarding: this key is published at https://<domain>/.well-known/did.json
// and referenced from the DeDi registry (see docs/concepts/setup-register/register.md).
// Here we simulate the same shape locally for a test publisher: did:web:ies.merc.example
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const KEYS_DIR = new URL("../keys/", import.meta.url);
mkdirSync(KEYS_DIR, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const publicJwk = publicKey.export({ format: "jwk" });
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
const publicPem = publicKey.export({ format: "pem", type: "spki" });

writeFileSync(new URL("private.pem", KEYS_DIR), privatePem);
writeFileSync(new URL("public.pem", KEYS_DIR), publicPem);

// did:web document, mirroring what the real IES flow publishes at
// https://ies.merc.example/.well-known/did.json
const didDocument = {
  "@context": "https://www.w3.org/ns/did/v1",
  id: "did:web:ies.merc.example",
  verificationMethod: [
    {
      id: "did:web:ies.merc.example#key-1",
      type: "JsonWebKey2020",
      controller: "did:web:ies.merc.example",
      publicKeyJwk: { ...publicJwk, kid: "key-1" }
    }
  ],
  assertionMethod: ["did:web:ies.merc.example#key-1"]
};

writeFileSync(new URL("did.json", KEYS_DIR), JSON.stringify(didDocument, null, 2));

console.log("Generated publisher signing identity: did:web:ies.merc.example");
console.log("  keys/private.pem  (keep secret; simulates the SERC's signing key)");
console.log("  keys/public.pem");
console.log("  keys/did.json      (what would be served at /.well-known/did.json)");
