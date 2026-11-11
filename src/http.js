// Small fetch helper: timeout, one retry, identifiable user agent.
const UA = "IsTahoeIn/0.1 (+https://github.com/; conditions aggregator, polls every 30 min)";

export async function get(url, { type = "json", timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: type === "json" ? "application/json" : "text/html,*/*" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return type === "json" ? await res.json() : await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export const ftToM = ft => Math.round(ft * 0.3048);
export const isoDate = d => d.toISOString().slice(0, 10);
