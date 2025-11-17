import { Client } from "@blink-sdk/compute-protocol/client";
import type { Stream } from "@blink-sdk/multiplexer";
import Multiplexer from "@blink-sdk/multiplexer";
import type { WebSocket } from "ws";

export const WORKSPACE_INFO_KEY = "__compute_workspace_id";

export const newComputeClient = async (ws: WebSocket): Promise<Client> => {
  return new Promise<Client>((resolve, reject) => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Create multiplexer for the client
    const multiplexer = new Multiplexer({
      send: (data: Uint8Array) => {
        ws.send(data);
      },
      isClient: true,
    });

    // Create a stream for requests
    const clientStream = multiplexer.createStream();

    const client = new Client({
      send: (message: string) => {
        // Type 0x00 = REQUEST
        clientStream.writeTyped(0x00, encoder.encode(message), true);
      },
    });

    // Handle incoming data from the server
    clientStream.onData((data: Uint8Array) => {
      const payload = data.subarray(1);
      const decoded = decoder.decode(payload);
      client.handleMessage(decoded);
    });

    // Listen for notification streams from the server
    multiplexer.onStream((stream: Stream) => {
      stream.onData((data: Uint8Array) => {
        const payload = data.subarray(1);
        const decoded = decoder.decode(payload);
        client.handleMessage(decoded);
      });
    });

    // Forward WebSocket messages to multiplexer
    ws.on("message", (data: Buffer) => {
      multiplexer.handleMessage(new Uint8Array(data));
    });

    ws.onopen = () => {
      resolve(client);
    };
    ws.onerror = (event) => {
      client.dispose("connection error");
      reject(event);
    };
  });
};
