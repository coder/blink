// Load the core package first so Bun initializes Lexical's shared exports before @lexical/react.
import "lexical";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import type { UIAttachment } from "@/hooks/use-attachments";
import type { ChatMessageInputRef } from "./chat-message-input";
import {
  ChatMultimodalInput,
  getInputLocalStorageKey,
} from "./chat-multimodal-input";
import { PreviewAttachment } from "./preview-attachment";

beforeAll(() => {
  globalThis.window = new Window() as any;
  globalThis.document = window.document;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.getComputedStyle = window.getComputedStyle;
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
});

test("loads input value from localStorage", async () => {
  window.localStorage.setItem(getInputLocalStorageKey("", false), "1");
  const messageInputRef: React.RefObject<ChatMessageInputRef | null> = {
    current: null,
  };
  render(<ChatMultimodalInput messageInputRef={messageInputRef} />);
  if (!messageInputRef.current) {
    throw new Error("Message input ref is not set");
  }
  messageInputRef.current.insertText("2");
  await waitFor(() => {
    const value = window.localStorage.getItem(
      getInputLocalStorageKey("", false)
    );
    expect(value).toBe("12");
  });
});

test("clears input when chat changes", async () => {
  const messageInputRef: React.RefObject<ChatMessageInputRef | null> = {
    current: null,
  };
  const inputValueRef: React.RefObject<string> = {
    current: "",
  };
  let chatID = "1";

  const { rerender } = render(
    <ChatMultimodalInput
      id={chatID}
      messageInputRef={messageInputRef}
      inputValueRef={inputValueRef}
    />
  );
  if (!messageInputRef.current) {
    throw new Error("Message input ref is not set");
  }
  messageInputRef.current.insertText("1");
  await waitFor(() => {
    expect(inputValueRef.current).toBe("1");
  });
  chatID = "2";
  rerender(
    <ChatMultimodalInput
      messageInputRef={messageInputRef}
      inputValueRef={inputValueRef}
      id={chatID}
    />
  );
  await waitFor(() => {
    expect(inputValueRef.current).toBe("");
  });
});

test("button should be disabled when there is no content", async () => {
  const messageInputRef: React.RefObject<ChatMessageInputRef | null> = {
    current: null,
  };

  const { container } = render(
    <ChatMultimodalInput messageInputRef={messageInputRef} />
  );

  const sendButton = container.querySelector('[data-testid="send-button"]');
  expect(sendButton?.hasAttribute("disabled")).toBe(true);
});

test("button should be enabled when text input exists", async () => {
  const messageInputRef: React.RefObject<ChatMessageInputRef | null> = {
    current: null,
  };

  const { container } = render(
    <ChatMultimodalInput messageInputRef={messageInputRef} />
  );

  if (!messageInputRef.current) {
    throw new Error("Message input ref is not set");
  }

  messageInputRef.current.insertText("Hello");

  await waitFor(() => {
    const sendButton = container.querySelector('[data-testid="send-button"]');
    expect(sendButton?.hasAttribute("disabled")).toBe(false);
  });
});

test("button should be clickable when enabled", async () => {
  const messageInputRef: React.RefObject<ChatMessageInputRef | null> = {
    current: null,
  };

  const { container } = render(
    <ChatMultimodalInput messageInputRef={messageInputRef} />
  );

  if (!messageInputRef.current) {
    throw new Error("Message input ref is not set");
  }

  messageInputRef.current.insertText("Hello");

  await waitFor(() => {
    const sendButton = container.querySelector('[data-testid="send-button"]');
    expect(sendButton?.hasAttribute("disabled")).toBe(false);
  });

  const sendButton = container.querySelector('[data-testid="send-button"]');
  if (sendButton) {
    fireEvent.click(sendButton);
  }
});

test("delete button calls onDelete when clicked", async () => {
  const mockOnRemove = mock(() => {});
  const mockAttachment: UIAttachment = {
    id: "1",
    fileName: "test-file.jpg",
    contentType: "image/jpeg",
    state: "uploading",
    progress: 0,
    byteLength: 100,
  };

  const { getByTestId } = render(
    <PreviewAttachment attachment={mockAttachment} onRemove={mockOnRemove} />
  );

  // Find and click the delete button
  const deleteButton = getByTestId("delete-attachment-button");
  fireEvent.click(deleteButton);

  // Verify the onDelete callback was called
  expect(mockOnRemove).toHaveBeenCalledTimes(1);
});
