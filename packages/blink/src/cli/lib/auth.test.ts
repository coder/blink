import { expect, test } from "bun:test";
import { normalizeHost } from "./auth";

test("normalizeHost", () => {
  const cases: [string, string][] = [
    // adds https:// for regular domains
    ["example.com", "https://example.com"],
    ["blink.coder.com", "https://blink.coder.com"],

    // adds http:// for localhost
    ["localhost", "http://localhost"],
    ["localhost:3000", "http://localhost:3000"],

    // adds http:// for IPv4 addresses
    ["127.0.0.1", "http://127.0.0.1"],
    ["192.168.1.1", "http://192.168.1.1"],
    ["192.168.1.1:8080", "http://192.168.1.1:8080"],

    // adds http:// for IPv6 addresses
    ["::1", "http://::1"],

    // preserves https://
    ["https://example.com", "https://example.com"],

    // preserves https:// on localhost and IPs
    ["https://localhost", "https://localhost"],
    ["https://localhost:3000", "https://localhost:3000"],
    ["https://127.0.0.1", "https://127.0.0.1"],
    ["https://192.168.1.1:8080", "https://192.168.1.1:8080"],
    ["https://::1", "https://::1"],

    // preserves http://
    ["http://example.com", "http://example.com"],
    ["http://blink.coder.com", "http://blink.coder.com"],

    // strips paths
    ["example.com/api/v1", "https://example.com"],
    ["https://example.com/path/to/resource", "https://example.com"],
    ["localhost:3000/api", "http://localhost:3000"],

    // strips trailing slashes
    ["example.com/", "https://example.com"],
    ["https://example.com/", "https://example.com"],

    // preserves port on regular domains
    ["example.com:8080", "https://example.com:8080"],
    ["https://example.com:443", "https://example.com:443"],

    // preserves port on localhost
    ["localhost:3000", "http://localhost:3000"],
    ["http://localhost:8080", "http://localhost:8080"],
  ];

  for (const [input, expected] of cases) {
    expect(normalizeHost(input)).toBe(expected);
  }
});
