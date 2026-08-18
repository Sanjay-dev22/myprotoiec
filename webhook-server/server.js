// A REAL BPP-side webhook backend for UC3 (Policy as Code), replacing the
// devkit's generic fixture-serving `sandbox-bpp` stand-in. This is what
// closes the gap noted in README.md: previously we swapped a STATIC file
// into the sandbox's fixture directory. This server instead authors and
// signs the policy FRESH, from our own code, on every incoming `status`
// request — the actual bar UC3 exists to prove (a real BPP backend, not a
// canned response).
//
// onix-bpp is configured (config/local-simple-routing-BPPReceiver.yaml) to
// forward every action to http://sandbox-bpp:3002/api/webhook/<action> — we
// took over that hostname/port in docker-compose.yml, so no onix config
// needed to change at all.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { buildSignedPolicy } from "./src/policyEngine.js";

const PORT = 3002;
const ISSUER = "did:web:ies.merc.example";
const privateKeyPem = readFileSync("/app/keys/private.pem");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function baseContext(incomingContext, action) {
  const ctx = incomingContext ?? {};
  return {
    networkId: ctx.networkId ?? "nfh.global/testnet-deg",
    version: ctx.version ?? "2.0.0",
    action,
    bapId: ctx.bapId ?? "bap.example.com",
    bapUri: ctx.bapUri ?? "http://beckn-router:9000/bap/receiver",
    bppId: ctx.bppId ?? "bpp.example.com",
    bppUri: ctx.bppUri ?? "http://beckn-router:9000/bpp/receiver",
    transactionId: ctx.transactionId,
    messageId: ctx.messageId,
    timestamp: new Date().toISOString()
  };
}

function handleConfirm(body) {
  const contractId = body?.message?.contract?.id ?? "770e9500-f30c-52e5-b827-557766551301";
  return {
    context: baseContext(body?.context, "on_confirm"),
    message: {
      contract: {
        id: contractId,
        descriptor: { name: "Retail Tariff Policy Subscription", shortDesc: "MeraShehar DISCOM subscribing to MERC retail tariff orders under public-disclosure norms" },
        status: { code: "ACTIVE" },
        commitments: body?.message?.contract?.commitments ?? [],
        consideration: body?.message?.contract?.consideration ?? [],
        participants: [
          { id: "merc-regulator-001", descriptor: { name: "Maharashtra Electricity Regulatory Commission" } },
          { id: "merashehar-discom-001", descriptor: { name: "MeraShehar - Distribution Company" } }
        ],
        performance: [],
        settlements: []
      }
    }
  };
}

// The consequential handler: builds + signs the policy LIVE, from our own
// code (policyEngine.js), on every single request. Nothing here is a static
// file being handed back.
function handleStatus(body) {
  const envelope = buildSignedPolicy(privateKeyPem, ISSUER);
  const contractId = body?.message?.contract?.id ?? "770e9500-f30c-52e5-b827-557766551301";
  const commitmentId = body?.message?.contract?.commitments?.[0]?.id ?? "commitment-tariff-policy-001";

  console.log(`[live-author] built + signed policy ${envelope.policy.policyID} (${envelope.policy.id}) at ${envelope.publication.issuedAt}`);

  return {
    context: baseContext(body?.context, "on_status"),
    message: {
      contract: {
        id: contractId,
        descriptor: { name: "Retail Tariff Policy Subscription", shortDesc: "MeraShehar DISCOM subscribing to MERC retail tariff orders under public-disclosure norms" },
        status: { code: "ACTIVE" },
        commitments: [
          {
            id: commitmentId,
            status: { descriptor: { code: "CLOSED" } },
            resources: [{ id: "ds-tariff-policy-mum-res-2024-25", descriptor: { name: "Mumbai Residential Telescopic Tariff 2024-25" }, quantity: { unitText: "policy", unitCode: "EA", value: "1" } }],
            offer: { id: "offer-tariff-policy-inline", descriptor: { name: "Inline Tariff Policy Delivery - Mumbai Residential 2024-25" }, resourceIds: ["ds-tariff-policy-mum-res-2024-25"] }
          }
        ],
        performance: [
          {
            id: "perf-tariff-policy-delivery-001",
            status: { code: "DELIVERY_COMPLETE", name: "Tariff policy delivered inline via dataPayload" },
            commitmentIds: [commitmentId],
            performanceAttributes: {
              "@context": "https://schema.nfh.global/DatasetItem/1.1/context.jsonld",
              "@type": "DatasetItem",
              "schema:identifier": "ds-tariff-policy-mum-res-2024-25",
              "schema:name": "Mumbai Residential Telescopic Tariff 2024-25",
              "schema:temporalCoverage": "2024-04-01/2025-03-31",
              "dataset:accessMethod": "INLINE",
              dataPayload: envelope.policy,
              iesPublication: envelope.publication
            }
          }
        ],
        participants: [
          { id: "merc-regulator-001", descriptor: { name: "Maharashtra Electricity Regulatory Commission" } },
          { id: "merashehar-discom-001", descriptor: { name: "MeraShehar - Distribution Company" } }
        ],
        settlements: [
          {
            id: "settlement-tariff-no-charge",
            considerationId: "consideration-tariff-public-good",
            status: "COMPLETE",
            settlementAttributes: {
              "@context": "https://schema.nfh.global/Payment/2.0/context.jsonld",
              "@type": "Payment",
              "beckn:paymentStatus": "COMPLETED",
              "beckn:amount": { currency: "INR", value: 0 }
            }
          }
        ]
      }
    }
  };
}

const ONIX_BPP_CALLER = "http://onix-bpp:8082/bpp/caller";

// onix-bpp's receiver forwards the inbound request to us and expects a quick
// ACK back — the actual on_x reply is a SEPARATE outbound call WE make into
// onix-bpp's own /bpp/caller/ endpoint, which signs it and relays it onward
// to the BAP over the router. (Confirmed by comparing against how the
// original fixture-based sandbox-bpp behaved: it never returned the on_x
// body as the webhook's HTTP response either — it must have made this same
// second call, which is why the round trip worked before we could see this.)
async function emitOnAction(action, payload) {
  const url = `${ONIX_BPP_CALLER}/${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  console.log(`[emit] POST ${url} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error(`onix-bpp caller rejected ${action}: HTTP ${res.status} ${text}`);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "ies-uc3-live-webhook" }));
    return;
  }

  const match = /^\/api\/webhook\/(\w+)$/.exec(req.url ?? "");
  if (req.method === "POST" && match) {
    const action = match[1];
    try {
      const body = await readBody(req);

      // ACK the inbound webhook call immediately.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { ack: { status: "ACK" } } }));

      // Then build the real reply and push it back through onix-bpp's own
      // caller interface, which signs and relays it to the BAP side.
      if (action === "confirm") {
        await emitOnAction("on_confirm", handleConfirm(body));
      } else if (action === "status") {
        await emitOnAction("on_status", handleStatus(body));
      }
      // other actions (select, init, track, ...): ACK only, no reply needed
      // for the UC3 flow this prototype exercises.
    } catch (err) {
      console.error(`Error handling ${action}:`, err);
      // response headers already sent (ACK) — log only, matches how a real
      // async webhook backend can't retroactively fail the original call.
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Live UC3 policy webhook listening on :${PORT}`);
  console.log(`  /api/webhook/confirm  -> ACTIVE contract ack`);
  console.log(`  /api/webhook/status   -> freshly authored + signed IES_Policy, built on every request`);
});
