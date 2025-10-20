import { test, expect } from "bun:test";
import { render } from "./terminal";
import { BLINK_COMMAND } from "./terminal";

test("escape codes are rendered", async () => {
  using term = render(
    `sh -c "echo 'Hello from the terminal! Here is some \x1b[31mred text\x1b[0m'!"`
  );
  await term.waitUntil((screen) => screen.includes("Here is some red text!"));
});

test("blink command is rendered", async () => {
  using term = render(`${BLINK_COMMAND} --help`);
  await term.waitUntil((screen) => screen.includes("Usage: blink"));
});
