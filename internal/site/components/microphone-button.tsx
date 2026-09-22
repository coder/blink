"use client";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LoaderIcon } from "./icons";
import { Button } from "./ui/button";

// TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

/**
 * Check if the Web Speech API is supported in the current browser.
 */
function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Create a SpeechRecognition instance if supported.
 */
function createSpeechRecognition(): SpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const SpeechRecognitionClass =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionClass) return null;
  return new SpeechRecognitionClass();
}

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
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef<string>("");

  // Check for browser support on mount
  useEffect(() => {
    setIsSupported(isSpeechRecognitionSupported());
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(() => {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    recognitionRef.current = recognition;
    transcriptRef.current = "";

    // Configure recognition
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          }
        }
      }

      if (finalTranscript) {
        transcriptRef.current += finalTranscript;
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);

      // Don't show error for aborted (user stopped) or no-speech
      if (event.error === "aborted" || event.error === "no-speech") {
        return;
      }

      let message = "Speech recognition failed. Please try again.";
      if (event.error === "not-allowed") {
        message =
          "Microphone access was blocked. Enable it in your browser settings.";
      } else if (event.error === "network") {
        message = "Network error during speech recognition.";
      } else if (event.error === "audio-capture") {
        message = "No microphone found. Check your input device.";
      }

      toast.error(message);
    };

    recognition.onend = () => {
      setIsRecording(false);

      // Send the accumulated transcript
      const finalText = transcriptRef.current.trim();
      if (finalText) {
        onTranscript(finalText);
      }

      recognitionRef.current = null;
      transcriptRef.current = "";
    };

    try {
      recognition.start();
    } catch (error) {
      console.error("Error starting speech recognition:", error);
      toast.error("Failed to start speech recognition.");
      setIsRecording(false);
    }
  }, [onTranscript]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Don't render the button if speech recognition is not supported
  if (!isSupported) {
    return null;
  }

  const getButtonIcon = () => {
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
      disabled={disabled}
      variant={getButtonVariant()}
      title={getTooltipText()}
    >
      {getButtonIcon()}
    </Button>
  );
}
