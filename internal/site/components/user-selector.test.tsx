import { cleanup, render, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { Window } from "happy-dom";
import { UserSelector } from "./user-selector";

beforeAll(() => {
  const window = new Window({
    url: "http://localhost",
    settings: {
      navigator: {
        userAgent: "Mozilla/5.0",
      },
    },
  });
  globalThis.window = window as any;
  globalThis.document = window.document as any;
  globalThis.HTMLElement = window.HTMLElement as any;
  globalThis.MutationObserver = window.MutationObserver as any;
  globalThis.getComputedStyle = window.getComputedStyle as any;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
  globalThis.cancelAnimationFrame = () => {};
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  // @ts-ignore
  delete globalThis.window;
  // @ts-ignore
  delete globalThis.document;
  // @ts-ignore
  delete globalThis.HTMLElement;
  // @ts-ignore
  delete globalThis.MutationObserver;
  // @ts-ignore
  delete globalThis.getComputedStyle;
  // @ts-ignore
  delete globalThis.requestAnimationFrame;
  // @ts-ignore
  delete globalThis.cancelAnimationFrame;
});

describe("UserSelector", () => {
  test("renders with placeholder when no user selected", async () => {
    const { container } = render(
      <UserSelector
        organizationId="org-1"
        selectedUserId={null}
        onSelect={() => {}}
        placeholder="Choose a user"
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("Choose a user");
    });
  });

  test("accepts all required props without crashing", async () => {
    const { container } = render(
      <UserSelector
        organizationId="org-1"
        selectedUserId="user-1"
        onSelect={() => {}}
      />
    );

    await waitFor(() => {
      expect(container).toBeDefined();
    });
  });

  test("accepts optional excludeUserIds prop", async () => {
    const { container } = render(
      <UserSelector
        organizationId="org-1"
        selectedUserId={null}
        onSelect={() => {}}
        excludeUserIds={new Set(["user-2"])}
      />
    );

    await waitFor(() => {
      expect(container).toBeDefined();
    });
  });

  test("accepts optional includeOrganizationDefault prop", async () => {
    const { container } = render(
      <UserSelector
        organizationId="org-1"
        selectedUserId={null}
        onSelect={() => {}}
        includeOrganizationDefault={true}
      />
    );

    await waitFor(() => {
      expect(container).toBeDefined();
    });
  });
});
