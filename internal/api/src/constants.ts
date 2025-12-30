// Size limits for message parts and uploads
export const MESSAGE_LIMITS = {
  // Maximum size for a single message part (including data URLs)
  // 10MB limit to prevent abuse while allowing reasonable file attachments
  MAX_PART_SIZE_BYTES: 10 * 1024 * 1024, // 10MB

  // Maximum total size for all parts in a single message
  MAX_MESSAGE_SIZE_BYTES: 50 * 1024 * 1024, // 50MB

  // Maximum number of parts in a single message (prevents pathological cases)
  MAX_PARTS_PER_MESSAGE: 1000,

  // Maximum file upload size (for POST /api/files)
  MAX_FILE_UPLOAD_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
} as const;
