/**
 * Protocol schema for tunnel proxy messages.
 *
 * The protocol uses a binary format over WebSocket with multiplexed streams.
 * Each message has a 1-byte type prefix followed by the payload.
 */

/**
 * Message types sent from the server (Cloudflare Worker) to the client.
 */
export enum ServerMessageType {
  /** Initial proxy request with method, URL, and headers */
  PROXY_INIT = 0x01,
  /** Body data chunk for the proxy request */
  PROXY_BODY = 0x02,
  /** WebSocket message to forward */
  PROXY_WEBSOCKET_MESSAGE = 0x03,
  /** WebSocket close signal */
  PROXY_WEBSOCKET_CLOSE = 0x04,
}

/**
 * Message types sent from the client back to the server.
 */
export enum ClientMessageType {
  /** Initial proxy response with status code and headers */
  PROXY_INIT = 0x01,
  /** Body data chunk for the proxy response */
  PROXY_DATA = 0x02,
  /** WebSocket message to forward */
  PROXY_WEBSOCKET_MESSAGE = 0x03,
  /** WebSocket close signal */
  PROXY_WEBSOCKET_CLOSE = 0x04,
}

/**
 * Server-to-client: Initial proxy request.
 */
export interface ProxyInitRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Client-to-server: Initial proxy response.
 */
export interface ProxyInitResponse {
  status_code: number;
  status_message: string;
  headers: Record<string, string>;
  /** Set-Cookie headers must be sent separately to preserve multiple cookies */
  set_cookies?: string[];
}

/**
 * WebSocket close payload.
 */
export interface WebSocketClosePayload {
  code?: number;
  reason?: string;
}

/**
 * Connection established message sent to client.
 */
export interface ConnectionEstablished {
  /** The public URL for this tunnel */
  url: string;
  /** The tunnel ID (subdomain or path prefix) */
  id: string;
}

/**
 * Create a WebSocket message payload with type prefix.
 * First byte: 0x00 for text, 0x01 for binary.
 */
export function createWebSocketMessagePayload(
  payload: string | Uint8Array | ArrayBuffer,
  encoder: TextEncoder
): Uint8Array {
  const isText = typeof payload === "string";
  if (typeof payload === "string") {
    payload = encoder.encode(payload);
  }

  const arr = new Uint8Array(1 + payload.byteLength);
  arr[0] = isText ? 0x00 : 0x01;
  arr.set(new Uint8Array(payload), 1);
  return arr;
}

/**
 * Parse a WebSocket message payload.
 * Returns string for text messages, Uint8Array for binary.
 */
export function parseWebSocketMessagePayload(
  payload: Uint8Array,
  decoder: TextDecoder
): string | Uint8Array {
  if (payload[0] === 0x00) {
    return decoder.decode(payload.subarray(1));
  }
  return new Uint8Array(payload.subarray(1));
}
