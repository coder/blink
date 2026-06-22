import { afterAll, beforeAll, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import type { ChatMessageInputRef } from "./chat-message-input";

let ChatMessageInput: typeof import("./chat-message-input").ChatMessageInput;

beforeAll(async () => {
  globalThis.window = new Window() as any;
  globalThis.document = window.document;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.Text = window.Text;

  await import("lexical");
  ({ ChatMessageInput } = await import("./chat-message-input"));
});

afterAll(async () => {
  // @ts-expect-error
  delete globalThis.window;
  // @ts-expect-error
  delete globalThis.document;
  // @ts-expect-error
  delete globalThis.MutationObserver;
  // @ts-expect-error
  delete globalThis.getComputedStyle;
  // @ts-expect-error
  delete globalThis.Text;
});

test("has initial value", async () => {
  const { getByTestId, unmount } = render(
    <ChatMessageInput initialValue="Some magic value" />
  );
  const input = getByTestId("chat-message-input-content");
  await waitFor(() => {
    expect(input.innerText).toBe("Some magic value");
  });
  unmount();
});

test("updates when text is inserted", async () => {
  let ref!: ChatMessageInputRef;
  let value = "";
  render(
    <div>
      <ChatMessageInput
        initialValue="first"
        ref={(r) => {
          ref = r as ChatMessageInputRef;
        }}
        onChange={(e) => {
          value = e.target.value;
        }}
      />
    </div>
  );
  ref.insertText(" example");
  await waitFor(() => {
    expect(value).toBe("first example");
  });
});

test("clears input", async () => {
  let ref!: ChatMessageInputRef;
  let value = "first";
  const { container } = render(
    <ChatMessageInput
      initialValue="first"
      ref={(r) => {
        ref = r as ChatMessageInputRef;
      }}
      onChange={(e) => {
        value = e.target.value;
      }}
    />
  );
  await waitFor(() => {
    expect(value).toBe("first");
  });
  ref.clear();
  await waitFor(() => {
    const input = container.querySelector(
      '[data-testid="chat-message-input-content"]'
    );
    expect(input?.textContent).toBe("");
  });
});
