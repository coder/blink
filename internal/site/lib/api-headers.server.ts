/** Read private gateway credentials only when constructing a server API client. */
export function getAPIHeaders(): Record<string, string> | undefined {
  const value = process.env.BLINK_API_HEADERS;
  if (!value?.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((value) => typeof value !== "string")
    ) {
      throw new Error();
    }
    // Validate HTTP names and values and normalize case before passing them on.
    return Object.fromEntries(new Headers(parsed as Record<string, string>));
  } catch {
    // Parser and Headers errors can contain credentials; never propagate them.
    throw new Error(
      "BLINK_API_HEADERS must be a JSON object of valid HTTP headers with string values"
    );
  }
}
