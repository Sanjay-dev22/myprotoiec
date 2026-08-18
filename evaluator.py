#!/usr/bin/env python3
"""
Independent second implementation of the IES_Policy billing evaluator, in a
different language from src/evaluator.js. Its whole purpose is to prove the
point Tariff Intelligence exists to prove: "multiple billing systems running
the same Policy Pack produce identical results" (IES v0.4 Strategy Document,
Section A1.6). It intentionally re-implements the same documented method
(see src/evaluator.js header) from scratch rather than porting the JS file
line-by-line, so agreement is evidence of a shared, unambiguous spec reading
-- not of copy-paste.

Usage:
    python evaluator.py <signed-policy.json> <usage-intervals.json>
Prints a JSON bill to stdout, in the same shape as evaluator.js's return value,
for test/run.js to diff against the Node result.
"""
import json
import re
import sys
from datetime import datetime, timezone


def round2(n):
    return round(n + 1e-9, 2)


def parse_iso_time_to_seconds(iso_time):
    m = re.match(r"^T?(\d{2}):(\d{2}):(\d{2})Z?$", iso_time)
    if not m:
        raise ValueError(f"Unrecognized interval.start format: {iso_time}")
    hh, mm, ss = (int(x) for x in m.groups())
    return hh * 3600 + mm * 60 + ss


def parse_iso_duration_to_seconds(iso_duration):
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", iso_duration)
    if not m:
        raise ValueError(f"Unrecognized duration format: {iso_duration}")
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def to_seconds_of_day(iso_timestamp):
    ts = iso_timestamp.replace("Z", "+00:00")
    d = datetime.fromisoformat(ts).astimezone(timezone.utc)
    return d.hour * 3600 + d.minute * 60 + d.second


def is_in_daily_window(iso_timestamp, interval):
    t = to_seconds_of_day(iso_timestamp)
    start = parse_iso_time_to_seconds(interval["start"])
    duration_sec = parse_iso_duration_to_seconds(interval["duration"])
    end = start + duration_sec
    if end <= 86400:
        return start <= t < end
    # wraps past midnight
    return t >= start or t < end - 86400


def compute_bill(policy, usage_intervals):
    total_kwh = sum(iv["kWh"] for iv in usage_intervals)
    slabs = sorted(policy["energySlabs"], key=lambda s: s["start"])

    remaining = total_kwh
    base_charge = 0.0
    slab_breakdown = []
    trace = []
    for slab in slabs:
        span = float("inf") if slab["end"] is None else (slab["end"] - slab["start"] + 1)
        kwh_in_slab = max(0.0, min(remaining, span))
        if kwh_in_slab <= 0:
            continue
        charge = kwh_in_slab * slab["price"]
        base_charge += charge
        remaining -= kwh_in_slab
        slab_breakdown.append({"slabId": slab["id"], "kWh": kwh_in_slab, "rate": slab["price"], "charge": round2(charge)})
        trace.append(f"Slab {slab['id']}: {kwh_in_slab} kWh x Rs{slab['price']} = Rs{round2(charge)}")
        if remaining <= 0:
            break

    blended_rate = (base_charge / total_kwh) if total_kwh > 0 else 0.0
    trace.append(f"Total {total_kwh} kWh, base energy charge Rs{round2(base_charge)}, blended rate Rs{round2(blended_rate)}/kWh")

    surcharge_breakdown = []
    adjustment_total = 0.0
    for s in policy.get("surchargeTariffs", []):
        kwh_in_window = sum(iv["kWh"] for iv in usage_intervals if is_in_daily_window(iv["startTime"], s["interval"]))
        if kwh_in_window <= 0:
            continue
        if s["unit"] == "INR_PER_KWH":
            amount = kwh_in_window * s["value"]
        else:
            amount = kwh_in_window * blended_rate * (s["value"] / 100)
        adjustment_total += amount
        surcharge_breakdown.append({"id": s["id"], "kWh": kwh_in_window, "unit": s["unit"], "value": s["value"], "amount": round2(amount)})
        unit_label = "%" if s["unit"] == "PERCENT" else " INR/kWh"
        trace.append(f"Surcharge {s['id']}: {kwh_in_window} kWh in window [{s['interval']['start']}, +{s['interval']['duration']}) x {s['value']}{unit_label} = Rs{round2(amount)}")

    total = round2(base_charge + adjustment_total)
    trace.append(f"Total bill = Rs{round2(base_charge)} + Rs{round2(adjustment_total)} = Rs{total}")

    return {
        "policyID": policy["policyID"],
        "policyRef": policy["id"],
        "totalKwh": total_kwh,
        "baseCharge": round2(base_charge),
        "slabBreakdown": slab_breakdown,
        "surchargeBreakdown": surcharge_breakdown,
        "total": total,
        "trace": trace,
    }


if __name__ == "__main__":
    envelope_path, usage_path = sys.argv[1], sys.argv[2]
    with open(envelope_path, encoding="utf-8") as f:
        envelope = json.load(f)
    policy = envelope["policy"] if "policy" in envelope else envelope
    with open(usage_path, encoding="utf-8") as f:
        usage_intervals = json.load(f)
    print(json.dumps(compute_bill(policy, usage_intervals), indent=2))
