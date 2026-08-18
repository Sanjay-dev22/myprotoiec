// Minimal deterministic JSON canonicalization (subset of RFC 8785 JCS):
// recursively sort object keys, no insignificant whitespace. Sufficient for our
// flat numeric/string/array shapes. The Python evaluator implements the same
// rule (see evaluator.py:canonicalize) so both sides produce byte-identical
// bytes-to-sign / bytes-to-hash from the same object.
export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const body = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]));
  return "{" + body.join(",") + "}";
}
