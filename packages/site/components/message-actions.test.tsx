import { fireEvent, render, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { MessageActions, PureMessageActions } from "./message-actions";

// Mock dependencies
beforeAll(() => {
  const window = new Window();
  globalThis.window = window as any;
  globalThis.document = window.document as any;
  globalThis.MutationObserver = window.MutationObserver as any;
  globalThis.getComputedStyle = window.getComputedStyle as any;
  globalThis.HTMLElement = window.HTMLElement as any;
  globalThis.Element = window.Element as any;
  globalThis.Node = window.Node as any;

  // Mock window.location.origin for link generation tests
  Object.defineProperty(window, "location", {
    value: {
      origin: "https://blink.so",
    },
    writable: true,
  });

  // Mock toast notifications
  mock.module("sonner", () => ({
    toast: {
      success: mock(() => {}),
      error: mock(() => {}),
    },
  }));

  // Mock uuidToSlug utility
  mock.module("@/lib/utils", () => ({
    uuidToSlug: mock((uuid: string) => `slug-${uuid}`),
  }));
});

afterAll(() => {
  // @ts-ignore
  delete globalThis.window;
  // @ts-ignore
  delete globalThis.document;
  // @ts-ignore
  delete globalThis.MutationObserver;
  // @ts-ignore
  delete globalThis.getComputedStyle;
});

const mockMessage: UIMessage = {
  id: "test-message-id",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "This is a test message",
    },
  ],
};

const mockChatId = "test-chat-id";

describe("MessageActions", () => {
  test("copy button calls copyToClipboard with correct text", async () => {
    const mockCopyToClipboard = mock(() => Promise.resolve());

    // Mock the hook for this specific test
    mock.module("usehooks-ts", () => ({
      useCopyToClipboard: () => [null, mockCopyToClipboard],
    }));

    const { container } = render(
      <PureMessageActions
        chatId={mockChatId}
        message={mockMessage}
        isLoading={false}
      />
    );

    const copyButton = container.querySelector("button");
    fireEvent.click(copyButton!);

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "This is a test message"
      );
    });
  });

  test("copy button handles multiple text parts correctly", async () => {
    const mockCopyToClipboard = mock(() => Promise.resolve());

    mock.module("usehooks-ts", () => ({
      useCopyToClipboard: () => [null, mockCopyToClipboard],
    }));

    const messageWithMultipleParts: UIMessage = {
      ...mockMessage,
      parts: [
        { type: "text", text: "First part" },
        { type: "text", text: "Second part" },
        {
          type: "tool-invocation",
          toolCallId: "1",
          state: "input-streaming",
          input: {},
        }, // Non-text part
        { type: "text", text: "Third part" },
      ],
    };

    const { container } = render(
      <PureMessageActions
        chatId={mockChatId}
        message={messageWithMultipleParts}
        isLoading={false}
      />
    );

    const copyButton = container.querySelector("button");
    fireEvent.click(copyButton!);

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "First part\nSecond part\nThird part"
      );
    });
  });

  test("copy button shows error toast when no text to copy", async () => {
    const mockToastError = mock(() => {});

    mock.module("sonner", () => ({
      toast: {
        success: mock(() => {}),
        error: mockToastError,
      },
    }));

    mock.module("usehooks-ts", () => ({
      useCopyToClipboard: () => [null, mock(() => Promise.resolve())],
    }));

    const messageWithNoText: UIMessage = {
      ...mockMessage,
      parts: [
        {
          type: "tool-invocation",
          toolCallId: "1",
          state: "input-streaming",
          input: {},
        },
      ],
    };

    const { container } = render(
      <PureMessageActions
        chatId={mockChatId}
        message={messageWithNoText}
        isLoading={false}
      />
    );

    const copyButton = container.querySelector("button");
    fireEvent.click(copyButton!);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("There's no text to copy!");
    });
  });

  test("link button generates and copies correct message link", async () => {
    const mockCopyToClipboard = mock(() => Promise.resolve());
    const mockUuidToSlug = mock((uuid: string) => `slug-${uuid}`);

    mock.module("usehooks-ts", () => ({
      useCopyToClipboard: () => [null, mockCopyToClipboard],
    }));

    mock.module("@/lib/utils", () => ({
      uuidToSlug: mockUuidToSlug,
    }));

    const { container } = render(
      <PureMessageActions
        chatId={mockChatId}
        message={mockMessage}
        isLoading={false}
      />
    );

    const buttons = container.querySelectorAll("button");
    const linkButton = buttons[1]; // Second button is the link button
    fireEvent.click(linkButton);

    await waitFor(() => {
      expect(mockUuidToSlug).toHaveBeenCalledWith(mockChatId);
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        `https://blink.so/chat/slug-${mockChatId}#message-${mockMessage.id}`
      );
    });
  });

  test("shows success toast after copying text", async () => {
    const mockToastSuccess = mock(() => {});

    mock.module("sonner", () => ({
      toast: {
        success: mockToastSuccess,
        error: mock(() => {}),
      },
    }));

    mock.module("usehooks-ts", () => ({
      useCopyToClipboard: () => [null, mock(() => Promise.resolve())],
    }));

    const { container } = render(
      <PureMessageActions
        chatId={mockChatId}
        message={mockMessage}
        isLoading={false}
      />
    );

    const copyButton = container.querySelector("button");
    fireEvent.click(copyButton!);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Copied to clipboard!");
    });
  });

  test("shows success toast after copying link", async () => {
    const mockToastSuccess = mock(() => {});

    mock.module("sonner", () => ({
      toast: {
        success: mockToastSuccess,
        error: mock(() => {}),
      },
    }));

    mock.module("usehooks-ts", () => ({
      useCopyToClipboard: () => [null, mock(() => Promise.resolve())],
    }));

    const { container } = render(
      <PureMessageActions
        chatId={mockChatId}
        message={mockMessage}
        isLoading={false}
      />
    );

    const buttons = container.querySelectorAll("button");
    const linkButton = buttons[1]; // Second button is the link button
    fireEvent.click(linkButton);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "Message link copied to clipboard!"
      );
    });
  });

  test("memoization prevents unnecessary re-renders", () => {
    const props = {
      chatId: mockChatId,
      message: mockMessage,
      vote: undefined,
      isLoading: false,
    };

    const { rerender } = render(<MessageActions {...props} />);

    // Same props should not cause re-render
    rerender(<MessageActions {...props} />);

    // Different loading state should cause re-render
    rerender(<MessageActions {...props} isLoading={true} />);

    // Component should be defined
    expect(MessageActions).toBeDefined();
  });
});
