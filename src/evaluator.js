// The "small evaluator" the docs describe: "look up the applicable slab, look
// up the matching time-of-day surcharge, apply." Consumes a verified IES_Policy
// object plus a billing period's interval usage and produces a bill + a full
// audit trace (the "bill-calculation trace" derived view named in the docs'
// Annexure D).
//
// BILLING METHOD (documented here because IES_Policy itself does not specify
// one — see ../proposed-extensions.md, Open Item #4):
//   1. Telescopic energy charge: total period kWh is allocated progressively
//      across energySlabs (first slab's span, then next, etc; a null `end`
//      means "unbounded top slab").
//   2. Time-of-day surchargeTariffs adjust the blended per-kWh rate for
//      whatever energy falls inside their recurring daily window. `interval`
//      windows that cross midnight (start + duration wraps past 24:00) are
//      handled explicitly.
//   3. PERCENT adjustments apply to the blended base rate; INR_PER_KWH
//      adjustments are a flat per-kWh add/subtract, independent of the base
//      rate.
export function computeBill(policy, usageIntervals) {
  const trace = { policyID: policy.policyID, policyRef: policy.id, steps: [] };

  // --- Step 1: telescopic slab allocation over total period kWh ---
  const totalKwh = usageIntervals.reduce((sum, iv) => sum + iv.kWh, 0);
  const slabs = [...policy.energySlabs].sort((a, b) => a.start - b.start);

  let remaining = totalKwh;
  let baseCharge = 0;
  const slabBreakdown = [];
  for (const slab of slabs) {
    const span = slab.end === null ? Infinity : slab.end - slab.start + 1;
    const kwhInSlab = Math.max(0, Math.min(remaining, span));
    if (kwhInSlab <= 0) continue;
    const charge = kwhInSlab * slab.price;
    baseCharge += charge;
    remaining -= kwhInSlab;
    slabBreakdown.push({ slabId: slab.id, kWh: kwhInSlab, rate: slab.price, charge: round2(charge) });
    trace.steps.push(`Slab ${slab.id}: ${kwhInSlab} kWh x Rs${slab.price} = Rs${round2(charge)}`);
    if (remaining <= 0) break;
  }
  const blendedRate = totalKwh > 0 ? baseCharge / totalKwh : 0;
  trace.steps.push(`Total ${totalKwh} kWh, base energy charge Rs${round2(baseCharge)}, blended rate Rs${round2(blendedRate)}/kWh`);

  // --- Step 2: time-of-day surcharge/discount adjustments ---
  const surchargeBreakdown = [];
  let adjustmentTotal = 0;
  for (const s of policy.surchargeTariffs ?? []) {
    const kwhInWindow = usageIntervals
      .filter((iv) => isInDailyWindow(iv.startTime, s.interval))
      .reduce((sum, iv) => sum + iv.kWh, 0);
    if (kwhInWindow <= 0) continue;

    const amount =
      s.unit === "INR_PER_KWH"
        ? kwhInWindow * s.value
        : kwhInWindow * blendedRate * (s.value / 100);

    adjustmentTotal += amount;
    surchargeBreakdown.push({ id: s.id, kWh: kwhInWindow, unit: s.unit, value: s.value, amount: round2(amount) });
    trace.steps.push(
      `Surcharge ${s.id}: ${kwhInWindow} kWh in window [${s.interval.start}, +${s.interval.duration}) x ${s.value}${s.unit === "PERCENT" ? "%" : " INR/kWh"} = Rs${round2(amount)}`
    );
  }

  const total = round2(baseCharge + adjustmentTotal);
  trace.steps.push(`Total bill = Rs${round2(baseCharge)} + Rs${round2(adjustmentTotal)} = Rs${total}`);

  return { policyID: policy.policyID, policyRef: policy.id, totalKwh, baseCharge: round2(baseCharge), slabBreakdown, surchargeBreakdown, total, trace: trace.steps };
}

// Does an ISO timestamp's time-of-day fall inside a recurring daily window,
// handling windows that wrap past midnight (e.g. 23:00 + 6h -> 05:00 next day)?
function isInDailyWindow(isoTimestamp, interval) {
  const t = toSecondsOfDay(isoTimestamp);
  const start = parseIsoTimeToSeconds(interval.start);
  const durationSec = parseIsoDurationToSeconds(interval.duration);
  const end = start + durationSec; // may exceed 86400 -> wraps past midnight

  if (end <= 86400) {
    return t >= start && t < end;
  }
  // Wraps past midnight: window is [start,86400) U [0, end-86400)
  return t >= start || t < end - 86400;
}

function toSecondsOfDay(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

// Parses "T18:00:00Z" (as used in the real devkit example) -> seconds since midnight.
function parseIsoTimeToSeconds(isoTime) {
  const m = /^T?(\d{2}):(\d{2}):(\d{2})Z?$/.exec(isoTime);
  if (!m) throw new Error(`Unrecognized interval.start format: ${isoTime}`);
  const [, hh, mm, ss] = m;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

// Parses a simple ISO 8601 duration like "PT4H", "PT6H", "PT90M" -> seconds.
function parseIsoDurationToSeconds(isoDuration) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(isoDuration);
  if (!m) throw new Error(`Unrecognized duration format: ${isoDuration}`);
  const [, h, min, s] = m;
  return (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Number(s ?? 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
