"use client";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LoaderIcon } from "./icons";
import { Button } from "./ui/button";

interface MicrophoneButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  onRecordingStateChange?: (isRecording: boolean) => void;
}

export function MicrophoneButton({
  onTranscript,
  disabled,
  onRecordingStateChange,
}: MicrophoneButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [isRecording]);

  const getSupportedMimeType = () => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
    ];
    for (const type of candidates) {
      try {
        if (
          typeof window !== "undefined" &&
          "MediaRecorder" in window &&
          MediaRecorder.isTypeSupported(type)
        ) {
          return type;
        }
      } catch {}
    }
    return undefined;
  };

  const startRecording = useCallback(async () => {
    try {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
      } catch (err) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      if (!stream) {
        throw new Error("No audio stream available");
      }

      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const usedType = (mimeType ?? mediaRecorder.mimeType) || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: usedType });
        await transcribeAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error: any) {
      console.error("Error starting recording:", error);
      let message = "Failed to start recording.";
      if (
        error?.name === "NotAllowedError" ||
        error?.name === "SecurityError"
      ) {
        message =
          "Microphone access was blocked. Enable it in your browser/site settings.";
      } else if (
        error?.name === "NotFoundError" ||
        error?.name === "DevicesNotFoundError"
      ) {
        message = "No microphone found. Check your input device.";
      } else if (error?.name === "NotReadableError") {
        message = "Microphone is in use by another application.";
      }
      toast.error(message);
    }
  }, []);

  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsTranscribing(true);
      try {
        const formData = new FormData();
        formData.append("audio", audioBlob);

        const response = await fetch("/api/speech-to-text", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Transcription failed");
        }

        const result = (await response.json()) as { text: string };
        if (result.text) {
          onTranscript(result.text);
        }
      } catch (error) {
        console.error("Transcription error:", error);
        toast.error("Speech transcription failed. Please try again.");
      } finally {
        setIsTranscribing(false);
      }
    },
    [onTranscript]
  );

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  useEffect(() => {
    onRecordingStateChange?.(isRecording);
  }, [isRecording, onRecordingStateChange]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const getButtonIcon = () => {
    if (isTranscribing) {
      return (
        <div className="animate-spin">
          <LoaderIcon size={14} />
        </div>
      );
    }
    if (isRecording) {
      return <Mic size={14} className="text-white animate-pulse" />;
    }
    return <Mic size={14} />;
  };

  const getButtonVariant = () => {
    if (isRecording) {
      return "destructive" as const;
    }
    return "ghost" as const;
  };

  const getTooltipText = () => {
    if (isTranscribing) return "Processing speech...";
    if (isRecording) return "Stop recording";
    return "Start voice input";
  };

  return (
    <Button
      data-testid="microphone-button"
      className={`rounded-md p-[7px] size-8 dark:border-zinc-700 hover:dark:bg-zinc-900 hover:bg-zinc-200 flex items-center justify-center ${
        isRecording ? "bg-red-600 hover:bg-red-700 border-red-600" : ""
      }`}
      onClick={handleToggleRecording}
      disabled={disabled || isTranscribing}
      variant={getButtonVariant()}
      title={getTooltipText()}
    >
      {getButtonIcon()}
    </Button>
  );
}
