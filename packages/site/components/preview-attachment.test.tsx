import type { UIAttachment } from "@/hooks/use-attachments";
import { fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { PreviewAttachment } from "./preview-attachment";

beforeAll(() => {
  globalThis.window = new Window() as any;
  globalThis.document = window.document;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.getComputedStyle = window.getComputedStyle;
});

afterAll(async () => {
  // @ts-ignore
  delete globalThis.window;
  // @ts-ignore
  delete globalThis.document;
  // @ts-ignore
  delete globalThis.MutationObserver;
  // @ts-ignore
  delete globalThis.getComputedStyle;
});

const mockImageAttachment: UIAttachment = {
  id: "1",
  fileName: "test-image.jpg",
  contentType: "image/jpeg",
  state: "uploading",
  progress: 0,
  byteLength: 100,
};

// Behavior test: Delete function is called when delete button is clicked
test("calls onDelete when delete button is clicked", () => {
  const mockOnRemove = mock(() => {});
  const { container } = render(
    <PreviewAttachment
      attachment={mockImageAttachment}
      onRemove={mockOnRemove}
    />
  );

  const deleteButton = container.querySelector(
    '[data-testid="delete-attachment-button"]'
  );
  expect(deleteButton).toBeTruthy();
  fireEvent.click(deleteButton!);

  expect(mockOnRemove).toHaveBeenCalledTimes(1);
});

// Behavior test: Event propagation is prevented when delete button is clicked
test("prevents event propagation when delete button is clicked", () => {
  const mockOnRemove = mock(() => {});
  const mockParentClick = mock(() => {});

  const { container } = render(
    <div onClick={mockParentClick}>
      <PreviewAttachment
        attachment={mockImageAttachment}
        onRemove={mockOnRemove}
      />
    </div>
  );

  const deleteButton = container.querySelector(
    '[data-testid="delete-attachment-button"]'
  );
  expect(deleteButton).toBeTruthy();
  fireEvent.click(deleteButton!);

  // Delete function should be called
  expect(mockOnRemove).toHaveBeenCalledTimes(1);
  // Parent click should NOT be called (event propagation prevented)
  expect(mockParentClick).toHaveBeenCalledTimes(0);
});

// Behavior test: Multiple clicks call the function multiple times
test("calls onDelete multiple times when clicked multiple times", () => {
  const mockOnRemove = mock(() => {});
  const { container } = render(
    <PreviewAttachment
      attachment={mockImageAttachment}
      onRemove={mockOnRemove}
    />
  );

  const deleteButton = container.querySelector(
    '[data-testid="delete-attachment-button"]'
  );
  expect(deleteButton).toBeTruthy();

  // Click multiple times
  fireEvent.click(deleteButton!);
  fireEvent.click(deleteButton!);
  fireEvent.click(deleteButton!);

  expect(mockOnRemove).toHaveBeenCalledTimes(3);
});

// Progress bar tests
test("shows upload progress bar when state is uploading", () => {
  const uploadingAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploading",
    progress: 50,
  };

  const { container } = render(
    <PreviewAttachment attachment={uploadingAttachment} />
  );

  const progressBar = container.querySelector(
    '[data-testid="upload-progress-bar"]'
  );
  expect(progressBar).toBeTruthy();

  // Check if progress percentage is displayed
  const progressText = container.textContent;
  expect(progressText).toContain("50%");
  expect(progressText).toContain("Uploading...");
});

test("displays correct progress percentage and updates progress bar width", () => {
  const uploadingAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploading",
    progress: 75,
  };

  const { container } = render(
    <PreviewAttachment attachment={uploadingAttachment} />
  );

  // Check percentage text
  expect(container.textContent).toContain("75%");

  // Check progress bar fill width
  const progressFill = container.querySelector(
    '[data-testid="upload-progress-bar"] .h-full'
  );
  expect(progressFill).toBeTruthy();
  expect(progressFill!.getAttribute("style")).toContain("width: 75%");
});

test("does not show upload progress bar when state is uploaded", () => {
  const uploadedAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploaded",
    progress: 100,
  };

  const { container } = render(
    <PreviewAttachment attachment={uploadedAttachment} />
  );

  const progressBar = container.querySelector(
    '[data-testid="upload-progress-bar"]'
  );
  expect(progressBar).toBeNull();
});

test("does not show upload progress bar when state is error", () => {
  const errorAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "error",
    progress: 50,
    error: "Upload failed",
  };

  const { container } = render(
    <PreviewAttachment attachment={errorAttachment} />
  );

  const progressBar = container.querySelector(
    '[data-testid="upload-progress-bar"]'
  );
  expect(progressBar).toBeNull();
});

test("shows blue progress bar for incomplete uploads and green when complete", () => {
  const incompleteAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploading",
    progress: 80,
  };

  const { container, rerender } = render(
    <PreviewAttachment attachment={incompleteAttachment} />
  );

  // Check blue progress bar for incomplete upload
  let progressFill = container.querySelector(
    '[data-testid="upload-progress-bar"] .h-full'
  );
  expect(progressFill).toBeTruthy();
  expect(progressFill!.className).toContain("bg-blue-500");

  // Update to complete upload
  const completeAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploading",
    progress: 100,
  };

  rerender(<PreviewAttachment attachment={completeAttachment} />);

  // Check green progress bar for complete upload
  progressFill = container.querySelector(
    '[data-testid="upload-progress-bar"] .h-full'
  );
  expect(progressFill).toBeTruthy();
  expect(progressFill!.className).toContain("bg-green-500");
});

test("shows upload loader icon when uploading", () => {
  const uploadingAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploading",
    progress: 30,
  };

  const { container } = render(
    <PreviewAttachment attachment={uploadingAttachment} />
  );

  const loader = container.querySelector(
    '[data-testid="input-attachment-loader"]'
  );
  expect(loader).toBeTruthy();
  expect(loader!.className).toContain("animate-spin");
});

test("does not show upload loader icon when uploaded", () => {
  const uploadedAttachment: UIAttachment = {
    ...mockImageAttachment,
    state: "uploaded",
    progress: 100,
  };

  const { container } = render(
    <PreviewAttachment attachment={uploadedAttachment} />
  );

  const loader = container.querySelector(
    '[data-testid="input-attachment-loader"]'
  );
  expect(loader).toBeNull();
});
