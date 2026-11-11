// Small fetch helper: timeout, one retry, identifiable user agent.
const UA = "IsTahoeIn/0.1 (+https://github.com/dillonmsmith17/is-tahoe-in; conditions aggregator, polls every 30 min)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export async function get(url, { type = "json", timeoutMs = 20000, retries = 1, browser = false, body = null } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { "user-agent": browser ? BROWSER_UA : UA, accept: type === "json" ? "application/json" : "text/html,*/*" };
      if (body) headers["content-type"] = "application/json";
      const res = await fetch(url, { signal: ctrl.signal, headers, method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined });
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
