import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { Markdown, preprocessText } from "./markdown";
// Initialize happy-dom globals
import { cleanup, render } from "@testing-library/react";
import { GlobalWindow } from "happy-dom";
import { TooltipProvider } from "./ui/tooltip";

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
let testWindow: GlobalWindow;

beforeAll(() => {
  testWindow = new GlobalWindow({ url: "http://localhost" });
  for (const [name, value] of Object.entries({
    window: testWindow,
    document: testWindow.document,
  })) {
    previousGlobals.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name)
    );
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
});

afterEach(cleanup);

afterAll(() => {
  testWindow.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

describe("preprocessText", () => {
  test("preserves brackets", () => {
    const result = preprocessText("${coder_agent}");
    expect(result).toBe("${coder_agent}");
  });

  test("hides incomplete blink-citation streaming tag", () => {
    const result = preprocessText("Hello <blink-citation");
    expect(result).toBe("Hello ");
  });

  test("hides incomplete blink-shortcut streaming tag", () => {
    const result = preprocessText('Hello <blink-shortcut name="test"');
    expect(result).toBe("Hello ");
  });
});

describe("Markdown <blink-shortcut>", () => {
  test("renders decoded shortcut pill and text around it", () => {
    const name = btoa("repo/foo");
    const content = btoa("Open the foo repo");
    const { container } = render(
      <TooltipProvider>
        <Markdown>{`before <blink-shortcut name="${name}" content="${content}" /> after`}</Markdown>
      </TooltipProvider>
    );
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
    // Renders @name visually
    expect(container.textContent).toContain("@repo/foo");
  });

  test("drops invalid shortcut but preserves children", () => {
    const { container } = render(
      <TooltipProvider>
        <Markdown>{`before <blink-shortcut name="not-base64">inner</blink-shortcut> after`}</Markdown>
      </TooltipProvider>
    );
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("inner");
    expect(container.textContent).toContain("after");
  });

  test("strips user-content- prefix added by sanitize", () => {
    const name = btoa("abc");
    const content = btoa("xyz");
    const { container } = render(
      <TooltipProvider>
        <Markdown>{`<blink-shortcut name="user-content-${name}" content="user-content-${content}" />`}</Markdown>
      </TooltipProvider>
    );
    expect(container.textContent).toContain("@abc");
  });
});
