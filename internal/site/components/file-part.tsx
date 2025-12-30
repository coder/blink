"use client";

import type { FileUIPart } from "ai";
import { Download, FileText } from "lucide-react";

export function FilePart({ part }: { part: FileUIPart }) {
  const mediaType = part.mediaType || "";
  const filename = part.filename || "file";

  // Image files - render inline
  if (mediaType.startsWith("image/")) {
    return (
      <div className="rounded-lg overflow-hidden max-w-md border border-gray-200 dark:border-gray-700">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={part.url} alt={filename} className="w-full h-auto" />
      </div>
    );
  }

  // Video files - render video player
  if (mediaType.startsWith("video/")) {
    return (
      <div className="rounded-lg overflow-hidden max-w-md border border-gray-200 dark:border-gray-700">
        <video src={part.url} controls className="w-full h-auto">
          Your browser does not support the video tag.
        </video>
      </div>
    );
  }

  // PDF files - render inline viewer
  if (mediaType === "application/pdf") {
    return (
      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText
              size={16}
              className="text-gray-600 dark:text-gray-400 shrink-0"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              {filename}
            </span>
          </div>
          <a
            href={part.url}
            download={filename}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0 ml-2"
          >
            <Download size={16} />
          </a>
        </div>
        <iframe src={part.url} className="w-full h-96" title={filename} />
      </div>
    );
  }

  // Audio files - render audio player
  if (mediaType.startsWith("audio/")) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={16} className="text-gray-600 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {filename}
          </span>
        </div>
        <audio src={part.url} controls className="w-full" />
      </div>
    );
  }

  // Text files - could render inline or as download
  if (mediaType.startsWith("text/")) {
    return (
      <a
        href={part.url}
        download={filename}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <FileText size={16} className="text-gray-600 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {filename}
        </span>
        <Download size={14} className="text-gray-500 dark:text-gray-400" />
      </a>
    );
  }

  // Default - generic file download link
  return (
    <a
      href={part.url}
      download={filename}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
    >
      <FileText size={16} className="text-gray-600 dark:text-gray-400" />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {filename}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {mediaType || "Unknown file type"}
        </span>
      </div>
      <Download
        size={14}
        className="text-gray-500 dark:text-gray-400 shrink-0"
      />
    </a>
  );
}
