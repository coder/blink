import { describe, expect, test } from "bun:test";
import { formatMessage } from "./message";

describe("formatMessage", () => {
  describe("markdown to Slack formatting", () => {
    test("converts markdown links to Slack format", () => {
      expect(formatMessage("[click here](https://example.com)")).toBe(
        "<https://example.com|click here>"
      );
    });

    test("converts double-star bold to single-star bold", () => {
      expect(formatMessage("**hello**")).toBe("*hello*");
    });
  });

  describe("user ID mention wrapping", () => {
    test("wraps @-prefixed Slack user IDs", () => {
      expect(formatMessage("@U02UD2WE3HA")).toBe("<@U02UD2WE3HA>");
    });

    test("wraps bare Slack user IDs", () => {
      expect(formatMessage("user U02UD2WE3HA said")).toBe(
        "user <@U02UD2WE3HA> said"
      );
    });

    test("wraps workspace IDs starting with W", () => {
      expect(formatMessage("@W01AB2CD3EF")).toBe("<@W01AB2CD3EF>");
    });

    test("does not double-wrap already bracketed IDs", () => {
      expect(formatMessage("<@U02UD2WE3HA>")).toBe("<@U02UD2WE3HA>");
    });

    test("removes brackets from non-ID @handles", () => {
      expect(formatMessage("<@john.doe>")).toBe("@john.doe");
    });
  });

  describe("false-positive prevention", () => {
    test("does not match pure-alpha words like WORKSPACE", () => {
      const input = "CODER_WORKSPACE_IS_PREBUILD_CLAIM=true";
      expect(formatMessage(input)).toBe(input);
    });

    test("does not match UPPERCASE without digits", () => {
      expect(formatMessage("UNDEFINED")).toBe("UNDEFINED");
      expect(formatMessage("WORKSPACEID")).toBe("WORKSPACEID");
    });

    test("does not match short IDs", () => {
      expect(formatMessage("U1234")).toBe("U1234");
    });
  });

  describe("code block preservation", () => {
    test("does not format IDs inside inline code", () => {
      const input = "`U02UD2WE3HA`";
      expect(formatMessage(input)).toBe(input);
    });

    test("does not format IDs inside code blocks", () => {
      const input = "```\nU02UD2WE3HA\n```";
      expect(formatMessage(input)).toBe(input);
    });

    test("formats IDs outside code but preserves code content", () => {
      const input = "user U02UD2WE3HA said `U02UD2WE3HA`";
      expect(formatMessage(input)).toBe(
        "user <@U02UD2WE3HA> said `U02UD2WE3HA`"
      );
    });

    test("preserves markdown links inside code blocks", () => {
      const input = "```\n[text](url)\n```";
      expect(formatMessage(input)).toBe(input);
    });

    test("preserves bold syntax inside inline code", () => {
      const input = "`**not bold**`";
      expect(formatMessage(input)).toBe(input);
    });

    test("handles multiple code blocks", () => {
      const input = "`U02UD2WE3HA` and U02UD2WE3HA and ```U02UD2WE3HA```";
      expect(formatMessage(input)).toBe(
        "`U02UD2WE3HA` and <@U02UD2WE3HA> and ```U02UD2WE3HA```"
      );
    });

    test("does not format IDs inside code blocks with more than 3 backticks", () => {
      const input = "````\nU02UD2WE3HA\n````";
      expect(formatMessage(input)).toBe(input);
    });
  });

  describe("truncation", () => {
    test("truncates text longer than 3000 characters", () => {
      const input = "a".repeat(4000);
      expect(formatMessage(input).length).toBe(3000);
    });
  });
});
