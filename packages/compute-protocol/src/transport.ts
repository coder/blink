import Multiplexer from "@blink-sdk/multiplexer";
import { Client } from "./client";
import { Server, type ServerOptions } from "./server";

// createInMemoryClientServer creates a client and server that
// communiate over an in-memory transport.
//
// For testing or local runtime environments.
export function createInMemoryClientServer(
  options?: Omit<ServerOptions, "send">
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const server = new Server({
    ...options,
    send: (message) => {
      multiplexer.handleMessage(message);
    },
  });

  const multiplexer = new Multiplexer({
    send: (data) => {
      server.handleMessage(data);
    },
    isClient: true,
  });
  const clientStream = multiplexer.createStream();

  const client = new Client({
    send: (message) => {
      // Clients always send requests to the server.
      clientStream.writeTyped(0x00, encoder.encode(message), true);
    },
  });

  clientStream.onData((data) => {
    const payload = data.subarray(1);
    client.handleMessage(decoder.decode(payload));
  });

  // Also listen for any other streams created by the server (e.g., notifications)
  multiplexer.onStream((stream) => {
    stream.onData((data) => {
      const payload = data.subarray(1);
      client.handleMessage(decoder.decode(payload));
    });
  });

  return { client, server };
}
