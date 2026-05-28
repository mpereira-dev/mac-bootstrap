import dns from "node:dns/promises";

export async function checkNetwork(host = "github.com", timeoutMs = 3000) {
  const lookup = dns.lookup(host).then(() => true);
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([lookup, timeout]);
  } catch {
    return false;
  }
}
