/**
 * StockSense Pro — AI response parsing
 * --------------------------------------------------------------------------
 * Pure helpers for turning raw LLM text into usable data. The app's recurring
 * AI bug class is parsing: free-tier models wrap JSON in markdown fences, in
 * <think>/<reasoning> blocks, or in prose, and a caller that does JSON.parse()
 * instead of extractJSON() silently fails (the scoreSentiment bug). These are
 * extracted from index.html's extractJSON() and the portfolioDoctor shape guard
 * so the behaviour can be locked down with tests.
 *
 * Usage:
 *   - Node / tests:   import { extractJSON, isValidObject } from './lib/ai.js'
 *   - Browser:        <script type="module" src="/lib/ai.js"></script>
 *                     then window.SSAI.extractJSON(...)
 * --------------------------------------------------------------------------
 */

/**
 * Best-effort extraction of a JSON value from arbitrary model output.
 * Returns the parsed object/array, or null if nothing parseable is found.
 * Faithful port of index.html's extractJSON().
 */
export function extractJSON(text) {
  if (!text) return null;

  // Strategy 0: strip reasoning blocks (<think>, <reasoning>, <reflection>)
  // emitted by models like nemotron, then retry.
  let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
    .trim();
  if (stripped !== text) {
    try { return JSON.parse(stripped.trim()); } catch (e) {}
    const mdS = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdS) { try { return JSON.parse(mdS[1].trim()); } catch (e) {} }
    const fb = stripped.indexOf('{'), lb = stripped.lastIndexOf('}');
    if (fb >= 0 && lb > fb) { try { return JSON.parse(stripped.slice(fb, lb + 1)); } catch (e) {} }
  }

  // Strategy 1: direct parse
  try { return JSON.parse(text.trim()); } catch (e) {}

  // Strategy 2: fenced ```json ... ``` block
  const md = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch (e) {} }

  // Strategy 3: first { ... last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch (e) {}
  }

  // Strategy 4: first [ ... last ]  (arrays)
  const firstBrack = text.indexOf('[');
  const lastBrack = text.lastIndexOf(']');
  if (firstBrack >= 0 && lastBrack > firstBrack) {
    try { return JSON.parse(text.slice(firstBrack, lastBrack + 1)); } catch (e) {}
  }

  // Strategy 5: strip leading/trailing non-JSON and retry
  const cleaned = text
    .replace(/^[^{[]*/, '')
    .replace(/[^}\]]*$/, '')
    .trim();
  try { return JSON.parse(cleaned); } catch (e) {}

  return null;
}

/**
 * Shape guard used before trusting an AI object (mirrors portfolioDoctor's
 * `j && typeof j==='object' && !Array.isArray(j) && j.healthScore!=null`).
 * requiredKeys: a single key string or array of keys that must be non-null.
 */
export function isValidObject(j, requiredKeys = []) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  const keys = Array.isArray(requiredKeys) ? requiredKeys : [requiredKeys];
  return keys.every(k => j[k] != null);
}

/**
 * Parse model output AND validate its shape in one step. Returns the object
 * if it parses and has all required keys, else null. This is the pattern every
 * AI caller should use instead of a bare JSON.parse().
 */
export function parseValidated(text, requiredKeys = []) {
  const j = extractJSON(text);
  return isValidObject(j, requiredKeys) ? j : null;
}

if (typeof window !== 'undefined') {
  window.SSAI = { extractJSON, isValidObject, parseValidated };
}
