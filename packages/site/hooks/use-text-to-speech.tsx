"use client";

import type { ServerTextToSpeech } from "@blink.so/worker/api/text-to-speech";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Small crossfade to avoid boundary clicks/gaps between chunks (in milliseconds)
const FADE_MS = 40;

export interface SpeechToTextContext {
  playing: boolean;
  stop(): void;
  send(text: string): void;
}

const TextToSpeechContext = createContext<SpeechToTextContext>({
  playing: false,
  stop: () => {},
  send: () => {},
});

const TextToSpeechProvider = ({ children }: { children: React.ReactNode }) => {
  const textToSpeech = useTextToSpeechSolo();
  return (
    <TextToSpeechContext.Provider value={textToSpeech}>
      {children}
    </TextToSpeechContext.Provider>
  );
};

export const useTextToSpeech = (): SpeechToTextContext => {
  return useContext(TextToSpeechContext);
};

const useTextToSpeechSolo = (): SpeechToTextContext => {
  const ws = useRef<WebSocket | null>(null);
  const textQueue = useRef<string[]>([]);

  // Audio scheduling state
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const sourceQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const [playing, setPlaying] = useState(false);

  // Ensure decode/schedule happens strictly in arrival order
  const pendingChunksRef = useRef<string[]>([]);
  const processingRef = useRef<boolean>(false);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!audioContextRef.current) {
      const Ctor: typeof AudioContext =
        // @ts-expect-error - webkitAudioContext for Safari
        window.AudioContext || window.webkitAudioContext;
      audioContextRef.current = new Ctor();
    }
    return audioContextRef.current;
  }, []);

  const scheduleFromBase64 = useCallback(
    async (base64: string) => {
      const audioContext = ensureAudioContext();
      if (!audioContext) return;

      const uint8 = base64ToUint8(base64);
      const arrayBuffer = uint8.buffer.slice(
        uint8.byteOffset,
        uint8.byteOffset + uint8.byteLength
      );

      let audioBuffer: AudioBuffer;
      try {
        // decodeAudioData accepts an ArrayBuffer of encoded audio data
        audioBuffer = await audioContext.decodeAudioData(
          arrayBuffer as ArrayBuffer
        );
      } catch (error) {
        console.error("Failed to decode audio", error);
        return;
      }

      // Determine fade duration for this clip
      const maxFadeSec = audioBuffer.duration / 2;
      const fadeSec = Math.max(0, Math.min(FADE_MS / 1000, maxFadeSec));

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Use a gain envelope to crossfade
      const gain = audioContext.createGain();
      // Connect source -> gain -> destination
      source.connect(gain);
      gain.connect(audioContext.destination);

      // Initialize schedule baseline if behind currentTime
      if (nextPlayTimeRef.current < audioContext.currentTime) {
        nextPlayTimeRef.current = audioContext.currentTime;
      }

      // Overlap by fadeSec if there is a prior source
      let startTime = nextPlayTimeRef.current;
      if (sourceQueueRef.current.length > 0 && fadeSec > 0) {
        startTime = Math.max(
          audioContext.currentTime,
          nextPlayTimeRef.current - fadeSec
        );
      }
      const endTime = startTime + audioBuffer.duration;

      // Schedule gain envelope
      const startFadeEnd = startTime + fadeSec;
      const endFadeStart = Math.max(startTime, endTime - fadeSec);
      gain.gain.setValueAtTime(0, startTime);
      if (fadeSec > 0) {
        gain.gain.linearRampToValueAtTime(1, startFadeEnd);
        gain.gain.setValueAtTime(1, startFadeEnd);
        gain.gain.setValueAtTime(1, endFadeStart);
        gain.gain.linearRampToValueAtTime(0, endTime);
      } else {
        gain.gain.setValueAtTime(1, startTime);
      }

      source.start(startTime);
      source.addEventListener("ended", () => {
        sourceQueueRef.current.shift();
        if (sourceQueueRef.current.length === 0) {
          setPlaying(false);
        }
      });

      sourceQueueRef.current.push(source);
      setPlaying(true);
      // Track the end of this clip as the baseline for the next
      nextPlayTimeRef.current = endTime;
    },
    [ensureAudioContext]
  );

  const processPending = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (pendingChunksRef.current.length > 0) {
        const next = pendingChunksRef.current.shift();
        if (!next) break;
        await scheduleFromBase64(next);
      }
    } finally {
      processingRef.current = false;
    }
  }, [scheduleFromBase64]);

  const openSocketIfNeeded = useCallback(() => {
    const state = ws.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    const protocol =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "wss"
        : "ws";
    ws.current = new WebSocket(
      `${protocol}://${window.location.host}/api/text-to-speech`
    );
    ws.current.addEventListener("message", (event) => {
      const parsed = JSON.parse(event.data) as ServerTextToSpeech;
      if (parsed.audio) {
        pendingChunksRef.current.push(parsed.audio);
        void processPending();
      }
    });
    ws.current.addEventListener("close", () => {
      // If there are queued messages, attempt to reopen and flush them
      if (textQueue.current.length > 0) {
        ws.current = null;
        openSocketIfNeeded();
      }
    });
    ws.current.addEventListener("open", async () => {
      const audioContext = ensureAudioContext();
      if (audioContext?.state === "suspended") {
        try {
          await audioContext.resume();
        } catch {
          // ignore
        }
      }
      textQueue.current.forEach((message) => {
        ws.current?.send(message);
      });
      textQueue.current = [];
    });
  }, [ensureAudioContext, processPending]);

  const send = useCallback(
    (text: string) => {
      // iOS Safari requires resuming AudioContext within a user gesture
      const audioContext = ensureAudioContext();
      if (audioContext?.state === "suspended") {
        try {
          void audioContext.resume();
        } catch {
          // ignore
        }
      }

      openSocketIfNeeded();
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        textQueue.current.push(
          JSON.stringify({
            text,
          })
        );
        return;
      }
      ws.current.send(
        JSON.stringify({
          text,
        })
      );
    },
    [ensureAudioContext, openSocketIfNeeded]
  );

  const stop = useCallback(() => {
    // Stop and clear all scheduled sources
    sourceQueueRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // ignore
      }
    });
    sourceQueueRef.current = [];
    pendingChunksRef.current = [];
    nextPlayTimeRef.current = ensureAudioContext()?.currentTime ?? 0;
    setPlaying(false);
  }, [ensureAudioContext]);

  useEffect(() => {
    // On iOS Safari, the AudioContext must be unlocked by a user gesture.
    // Resume the context and play a short silent buffer on first interaction.
    if (typeof window === "undefined") return;

    const onInteract = async () => {
      const audioContext = ensureAudioContext();
      if (!audioContext) return;
      try {
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        // Play a very short silent buffer to fully unlock output on some iOS versions
        const durationSeconds = 0.01;
        const frameCount = Math.max(
          1,
          Math.floor(audioContext.sampleRate * durationSeconds)
        );
        const buffer = audioContext.createBuffer(
          1,
          frameCount,
          audioContext.sampleRate
        );
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        const startAt = Math.max(audioContext.currentTime, 0);
        source.start(startAt);
        source.stop(startAt + durationSeconds);
      } catch {
        // ignore
      }
    };

    const opts: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener("pointerdown", onInteract, opts);
    window.addEventListener("touchstart", onInteract, opts);
    window.addEventListener("keydown", onInteract, { once: true });

    return () => {
      window.removeEventListener(
        "pointerdown",
        onInteract,
        opts as EventListenerOptions
      );
      window.removeEventListener(
        "touchstart",
        onInteract,
        opts as EventListenerOptions
      );
      window.removeEventListener("keydown", onInteract, {
        capture: false,
      } as EventListenerOptions);
    };
  }, [ensureAudioContext]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      sourceQueueRef.current.forEach((s) => {
        try {
          s.stop();
        } catch {
          // ignore
        }
      });
      sourceQueueRef.current = [];
      pendingChunksRef.current = [];
      nextPlayTimeRef.current = 0;

      if (
        ws.current &&
        (ws.current.readyState === WebSocket.OPEN ||
          ws.current.readyState === WebSocket.CONNECTING)
      ) {
        try {
          ws.current.close();
        } catch {
          // ignore
        }
      }
      ws.current = null;

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {
          // ignore
        }
        audioContextRef.current = null;
      }
    };
  }, []);

  return {
    playing,
    stop,
    send,
  };
};

function base64ToUint8(base64: string): Uint8Array {
  return new Uint8Array(
    atob(base64)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
}
