// uploadToR2 is a helper function that uses a multipart upload to R2.
//
// We cannot pipe the stream directly to R2 because it has an unknown length.
// In order to use `put` directly with R2, we must have a fixed length.
export const uploadToR2 = async (
  storage: R2Bucket,
  key: string,
  stream: ReadableStream<Uint8Array>,
  contentType: string,
  abortSignal?: AbortSignal,
  fileName?: string
) => {
  const tarUpload = await storage.createMultipartUpload(key, {
    httpMetadata: {
      contentType,
    },
    customMetadata: fileName
      ? {
          name: fileName,
        }
      : undefined,
  });
  const reader = stream.getReader();

  const abortIfSignaled = async () => {
    if (abortSignal?.aborted) {
      try {
        await tarUpload.abort();
      } catch {}
      try {
        reader.cancel("aborted");
      } catch {}
      throw new DOMException("Aborted", "AbortError");
    }
  };
  const onAbort = async () => {
    try {
      await tarUpload.abort();
    } catch {}
    try {
      reader.cancel("aborted");
    } catch {}
  };
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  let partNumber = 1;
  let currentChunkBuffer: Uint8Array[] = [];
  let currentChunkBufferSize = 0;
  const uploadPromises: Promise<R2UploadedPart>[] = [];
  // 10MiB is recommended by Cloudflare.
  const fixedPartSize = 10 * 1024 * 1024;

  while (true) {
    await abortIfSignaled();
    // Read from the stream.
    const chunk = await reader.read();

    if (chunk.done) {
      await abortIfSignaled();
      // Create a final part from the remaining data.
      if (currentChunkBufferSize > 0) {
        const finalPartData = new Uint8Array(currentChunkBufferSize);
        let offset = 0;
        for (const b of currentChunkBuffer) {
          finalPartData.set(b, offset);
          offset += b.length;
        }
        await abortIfSignaled();
        uploadPromises.push(tarUpload.uploadPart(partNumber, finalPartData));
      }
      break;
    }

    // Add the chunk to the buffer.
    currentChunkBuffer.push(chunk.value);
    currentChunkBufferSize += chunk.value.length;

    // Process as many fixed-size parts as possible from the buffer.
    while (currentChunkBufferSize >= fixedPartSize) {
      await abortIfSignaled();
      const partData = new Uint8Array(fixedPartSize);
      let bytesWrittenToPart = 0; // How much of partData is filled
      const nextIterationChunkBuffer: Uint8Array[] = []; // Buffer for data remaining after this part

      for (let i = 0; i < currentChunkBuffer.length; i++) {
        const bufferEntry = currentChunkBuffer[i]!;
        const bytesToTakeFromEntry = Math.min(
          bufferEntry.length,
          fixedPartSize - bytesWrittenToPart
        );

        partData.set(
          bufferEntry.subarray(0, bytesToTakeFromEntry),
          bytesWrittenToPart
        );
        bytesWrittenToPart += bytesToTakeFromEntry;

        if (bufferEntry.length > bytesToTakeFromEntry) {
          // This bufferEntry was partially consumed, keep the remainder for the next processing cycle
          nextIterationChunkBuffer.push(
            bufferEntry.subarray(bytesToTakeFromEntry)
          );
        }

        if (bytesWrittenToPart === fixedPartSize) {
          // Part is full. Add subsequent unconsumed entries from currentChunkBuffer (if any) to nextIterationChunkBuffer
          for (let j = i + 1; j < currentChunkBuffer.length; j++) {
            nextIterationChunkBuffer.push(currentChunkBuffer[j]!);
          }
          break;
        }
      }

      await abortIfSignaled();
      uploadPromises.push(tarUpload.uploadPart(partNumber, partData));
      partNumber++;

      currentChunkBuffer = nextIterationChunkBuffer;
      // Recalculate currentChunkBufferSize based on the new state of currentChunkBuffer.
      currentChunkBufferSize = currentChunkBuffer.reduce(
        (sum, arr) => sum + arr.length,
        0
      );
    }
  }

  // Wait for all part uploads to complete.
  const uploadedParts = await Promise.all(uploadPromises);

  // Finalize the multipart upload.
  const obj = await tarUpload.complete(uploadedParts);
  abortSignal?.removeEventListener("abort", onAbort);
  return {
    size: obj.size,
  };
};
