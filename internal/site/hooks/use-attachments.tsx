import type { File as DBFile } from "@blink.so/database/schema";
import { useCallback, useMemo, useRef, useState } from "react";

export type UIAttachment = {
  readonly id: string;
  readonly state: "uploading" | "uploaded" | "error";
  readonly progress: number;
  readonly contentType: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly error?: string;
};

export const useAttachments = () => {
  const [attachments, setAttachments] = useState<UIAttachment[]>([]);
  const pendingUploads = useRef<Record<string, XMLHttpRequest>>({});

  const upload = useCallback((file: File) => {
    const id = crypto.randomUUID();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");

    // Use functional updates consistently to prevent race conditions
    const updateAttachment = (
      updater: (prev: UIAttachment) => UIAttachment
    ) => {
      setAttachments((prevAttachments) =>
        prevAttachments.map((a) => (a.id === id ? updater(a) : a))
      );
    };

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        updateAttachment((prev) => ({ ...prev, progress }));
      }
    };

    xhr.onload = () => {
      try {
        const response = JSON.parse(xhr.response) as DBFile | { error: string };
        if ("error" in response) {
          updateAttachment((prev) => ({
            ...prev,
            state: "error",
            error: response.error,
          }));
        } else {
          // Atomic update: change ID, state, and progress all at once
          setAttachments((prevAttachments) =>
            prevAttachments.map((a) =>
              a.id === id
                ? { ...a, id: response.id, state: "uploaded", progress: 100 }
                : a
            )
          );
        }
      } catch (error) {
        updateAttachment((prev) => ({
          ...prev,
          state: "error",
          error: "Failed to upload file",
        }));
      }
    };

    xhr.onerror = () => {
      updateAttachment((prev) => ({
        ...prev,
        state: "error",
        error: "Network error occurred",
      }));
    };

    xhr.onabort = () => {
      // Remove from attachments on abort
      setAttachments((prevAttachments) =>
        prevAttachments.filter((a) => a.id !== id)
      );
    };

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
    pendingUploads.current[id] = xhr;

    setAttachments((prev) => [
      ...prev,
      {
        id,
        state: "uploading",
        progress: 0,
        contentType: file.type,
        fileName: file.name,
        byteLength: file.size,
      },
    ]);
    return id;
  }, []);

  const remove = useCallback((id: string) => {
    const pendingRequest = pendingUploads.current[id];
    if (pendingRequest) {
      delete pendingUploads.current[id];
      pendingRequest.abort();
    }

    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const id in pendingUploads.current) {
      const pendingRequest = pendingUploads.current[id];
      if (pendingRequest) {
        pendingRequest.abort();
      }
    }
    pendingUploads.current = {};
    setAttachments([]);
  }, []);

  const uploading = useMemo(() => {
    return attachments.some((a) => a.state === "uploading");
  }, [attachments]);

  const context = useMemo(
    () => ({
      attachments,
      upload,
      clear,
      remove,
      uploading,
    }),
    [attachments, upload, clear, remove, uploading]
  );

  return context;
};
