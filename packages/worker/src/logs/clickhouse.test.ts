import { describe, expect, test } from "bun:test";
import { regexFromText } from "./clickhouse";

describe("regexFromText", () => {
  test("simple text without special characters", () => {
    expect(regexFromText("hello")).toBe("hello");
    expect(regexFromText("test message")).toBe("test message");
  });

  test("case insensitive flag", () => {
    expect(regexFromText("hello", { caseInsensitive: true })).toBe("(?i)hello");
    expect(regexFromText("test", { caseInsensitive: false })).toBe("test");
  });

  test("wildcard asterisks become .*", () => {
    expect(regexFromText("hello*world")).toBe("hello.*world");
    expect(regexFromText("*start")).toBe(".*start");
    expect(regexFromText("end*")).toBe("end.*");
    expect(regexFromText("*")).toBe(".*");
  });

  test("multiple wildcard asterisks", () => {
    expect(regexFromText("a*b*c")).toBe("a.*b.*c");
    expect(regexFromText("***")).toBe(".*.*.*");
  });

  test("literal backslash-asterisks stay as \\*", () => {
    expect(regexFromText("hello\\*world")).toBe("hello\\*world");
    expect(regexFromText("\\*start")).toBe("\\*start");
    expect(regexFromText("end\\*")).toBe("end\\*");
  });

  test("mixed literal and wildcard asterisks", () => {
    expect(regexFromText("hello\\*world*end")).toBe("hello\\*world.*end");
    expect(regexFromText("start*middle\\*finish")).toBe(
      "start.*middle\\*finish"
    );
    expect(regexFromText("\\**\\*")).toBe("\\*.*\\*");
  });

  test("regex metacharacters are escaped", () => {
    // Test common regex metacharacters
    expect(regexFromText("hello.world")).toBe("hello\\.world");
    expect(regexFromText("test[abc]")).toBe("test\\[abc\\]");
    expect(regexFromText("query?param=value")).toBe("query\\?param=value");
    expect(regexFromText("start^end$")).toBe("start\\^end\\$");
    expect(regexFromText("count+1")).toBe("count\\+1");
    expect(regexFromText("(group)")).toBe("\\(group\\)");
    expect(regexFromText("{key: value}")).toBe("\\{key: value\\}");
    expect(regexFromText("pipe|or")).toBe("pipe\\|or");
  });

  test("complex patterns with escaping and wildcards", () => {
    expect(regexFromText("*.log")).toBe(".*\\.log");
    expect(regexFromText("error[*]")).toBe("error\\[.*\\]");
    expect(regexFromText("test\\*.*backup")).toBe("test\\*\\..*backup");
  });

  test("empty string", () => {
    expect(regexFromText("")).toBe("");
    expect(regexFromText("", { caseInsensitive: true })).toBe("(?i)");
  });

  test("only special characters", () => {
    expect(regexFromText(".*+?")).toBe("\\..*\\+\\?");
    expect(regexFromText("[](){}")).toBe("\\[\\]\\(\\)\\{\\}");
  });

  test("backslash handling edge cases", () => {
    // Multiple consecutive literal asterisks
    expect(regexFromText("\\*\\*")).toBe("\\*\\*");

    // Backslash followed by other characters
    expect(regexFromText("\\n\\t")).toBe("\\\\n\\\\t");

    // Mixed backslashes and asterisks
    expect(regexFromText("\\\\*test")).toBe("\\\\\\*test");
  });

  test("escaping wildcards with backslash", () => {
    // Basic wildcard escaping
    expect(regexFromText("\\*")).toBe("\\*");
    expect(regexFromText("hello\\*world")).toBe("hello\\*world");
    expect(regexFromText("\\*start")).toBe("\\*start");
    expect(regexFromText("end\\*")).toBe("end\\*");

    // Multiple escaped wildcards
    expect(regexFromText("\\*\\*\\*")).toBe("\\*\\*\\*");
    expect(regexFromText("a\\*b\\*c")).toBe("a\\*b\\*c");

    // Mixed escaped and unescaped wildcards
    expect(regexFromText("*\\**")).toBe(".*\\*.*");
    expect(regexFromText("\\**\\*")).toBe("\\*.*\\*");
    expect(regexFromText("start*middle\\*end*")).toBe("start.*middle\\*end.*");

    // Escaped wildcards with other special characters
    expect(regexFromText("file\\*.log")).toBe("file\\*\\.log");
    expect(regexFromText("pattern\\*[test]")).toBe("pattern\\*\\[test\\]");

    // Case insensitive with escaped wildcards
    expect(regexFromText("ERROR\\*", { caseInsensitive: true })).toBe(
      "(?i)ERROR\\*"
    );
  });

  test("real-world log patterns", () => {
    // Common log filtering patterns
    expect(regexFromText("ERROR*")).toBe("ERROR.*");
    expect(regexFromText("*exception*")).toBe(".*exception.*");
    expect(regexFromText("user-123*login")).toBe("user-123.*login");
    expect(regexFromText("[INFO] * completed")).toBe("\\[INFO\\] .* completed");

    // With case insensitive
    expect(regexFromText("error*", { caseInsensitive: true })).toBe(
      "(?i)error.*"
    );
  });
});
