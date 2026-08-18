// End-to-end proof for UC3 (Policy as Code): verify a signed IES_Policy, then
// run TWO INDEPENDENT billing evaluators — src/evaluator.js (Node) and
// evaluator.py (Python) — against identical usage data and confirm they
// produce identical bills. This is the exact claim the docs make about
// Tariff Intelligence: "multiple billing systems running the same Policy Pack
// produce identical results." It also exercises the specific edge cases the
// official implementation checklist calls out (ies-docs-raw/page_017.md,
// step 7): open-ended top slab, surcharge-window wrap-around, percent vs
// absolute adders.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeBill } from "../src/evaluator.js";
import { verifyEnvelope } from "../src/verifyPolicy.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const POLICIES = path.join(ROOT, "policies");
const FIXTURES = path.join(ROOT, "test", "fixtures");
const KEYS = path.join(ROOT, "keys");
const PY_EVALUATOR = path.join(ROOT, "evaluator.py");

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

console.log("=== Step 0: signed policy exists? ===");
const signedPolicyPath = path.join(POLICIES, "mumbai-res-tariff.signed.json");
if (!existsSync(signedPolicyPath)) {
  console.error("Missing policies/mumbai-res-tariff.signed.json");
  console.error("Run first:  npm run keygen && npm run author");
  process.exit(1);
}

console.log("=== Step 1: verify signature against issuer's did:web document ===");
const envelope = loadJson(signedPolicyPath);
const did = loadJson(path.join(KEYS, "did.json"));
const verification = verifyEnvelope(envelope, did);
if (!verification.valid) {
  console.error(`Signature verification FAILED: ${verification.reason}`);
  process.exit(1);
}
console.log(`PASS  ${envelope.policy.policyID} signature verified against ${did.id}\n`);

console.log("=== Step 2: run identical scenarios through Node + Python evaluators ===\n");

const scenarios = [
  {
    name: "Normal month: multi-slab allocation + evening surcharge + midnight-wrapping night discount",
    policyFile: signedPolicyPath,
    usageFile: path.join(FIXTURES, "usage-normal.json")
  },
  {
    name: "Boundary: exactly 100 kWh (top of slab-0-100, no spillover)",
    policyFile: signedPolicyPath,
    usageFile: path.join(FIXTURES, "usage-boundary-100.json")
  },
  {
    name: "Open-ended top slab: 1000 kWh, well past slab-301-plus (end: null)",
    policyFile: signedPolicyPath,
    usageFile: path.join(FIXTURES, "usage-large.json")
  },
  {
    name: "Absolute adder: INR_PER_KWH surcharge instead of PERCENT",
    policyFile: path.join(FIXTURES, "policy-inr-surcharge.json"),
    usageFile: path.join(FIXTURES, "usage-evening-only.json")
  }
];

let allPassed = true;

for (const scenario of scenarios) {
  const envelopeOrPolicy = loadJson(scenario.policyFile);
  const policy = envelopeOrPolicy.policy ?? envelopeOrPolicy;
  const usage = loadJson(scenario.usageFile);

  const nodeResult = computeBill(policy, usage);

  const pyRun = spawnSync("python", [PY_EVALUATOR, scenario.policyFile, scenario.usageFile], { encoding: "utf-8" });
  if (pyRun.status !== 0) {
    console.error(`Python evaluator failed for "${scenario.name}":\n${pyRun.stderr}`);
    allPassed = false;
    continue;
  }
  const pyResult = JSON.parse(pyRun.stdout);

  const fieldsMatch =
    nodeResult.total === pyResult.total &&
    nodeResult.baseCharge === pyResult.baseCharge &&
    JSON.stringify(nodeResult.slabBreakdown) === JSON.stringify(pyResult.slabBreakdown) &&
    JSON.stringify(nodeResult.surchargeBreakdown) === JSON.stringify(pyResult.surchargeBreakdown);

  console.log(`--- ${scenario.name} ---`);
  console.log(`  Node   total: Rs${nodeResult.total}`);
  console.log(`  Python total: Rs${pyResult.total}`);
  console.log(`  ${fieldsMatch ? "PASS — identical bill from both independent evaluators" : "FAIL — evaluators disagree"}`);
  if (!fieldsMatch) allPassed = false;
  console.log();
}

console.log("=== Full audit trace, Node evaluator, first scenario ===");
const firstEnvelope = loadJson(scenarios[0].policyFile);
const firstUsage = loadJson(scenarios[0].usageFile);
const traceResult = computeBill(firstEnvelope.policy, firstUsage);
for (const line of traceResult.trace) console.log("  " + line);

console.log(`\n${allPassed ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED"}`);
process.exit(allPassed ? 0 : 1);
