/**
 * Public tunnel connection metadata.
 */
export interface ConnectionEstablished {
  /** The public URL for this tunnel */
  url: string;
  /** The tunnel ID (subdomain or path prefix) */
  id: string;
}

// JSON-encoded array of Set-Cookie values for proxy responses.
export const TUNNEL_COOKIE_HEADER = "x-tunnel-cookies";
