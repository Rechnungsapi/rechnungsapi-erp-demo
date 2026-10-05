// Safe defaults for a tool that runs on your own machine and talks to an API with your token.

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ")

/** Response headers for every page and API answer. */
export function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  })
  next()
}

/**
 * Keeps other websites from driving the demo through your browser.
 *
 * The demo has no login, so two checks protect it: the `Host` header must be one it expects
 * (this stops DNS rebinding), and a state-changing request that carries an `Origin` header must
 * come from the demo's own page.
 *
 * @param {{ allowedHosts?: string[] }} options  Extra host names, without port.
 */
export function hostGuard({ allowedHosts = [] } = {}) {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", ...allowedHosts])

  return (req, res, next) => {
    const hostHeader = String(req.headers.host ?? "").toLowerCase()
    const hostName = hostHeader.replace(/:\d+$/, "")
    if (!hosts.has(hostName)) {
      return res.status(421).json({
        error: "host_not_allowed",
        message: `This demo only answers to localhost. To use another host name, add "${hostName}" to ALLOWED_HOSTS.`,
      })
    }

    const origin = req.headers.origin
    const readOnly = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
    if (origin && !readOnly) {
      let sameOrigin = false
      try {
        sameOrigin = new URL(origin).host.toLowerCase() === hostHeader
      } catch {
        sameOrigin = false
      }
      if (!sameOrigin) {
        return res.status(403).json({ error: "cross_origin_blocked", message: "Requests from other websites are blocked." })
      }
    }
    next()
  }
}
