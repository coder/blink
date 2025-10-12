import { Emitter } from "@blink-sdk/events";

export enum MessageType {
  DATA = 0x0,
  CLOSE = 0x1,
  ERROR = 0x2,
}

export enum Flag {
  NEW = 0x1,
}

export interface Frame {
  streamId: number;
  type: MessageType;
  flags: number;
  payload: Uint8Array;
}

class BufferPool {
  private static readonly MAX_POOL_SIZE = 100;
  private static readonly COMMON_SIZES = [64, 256, 1024, 4096, 16384];
  private static pools = new Map<number, Uint8Array[]>();

  static {
    // Pre-populate pools with common sizes
    for (const size of this.COMMON_SIZES) {
      this.pools.set(size, []);
    }
  }

  static acquire(size: number): Uint8Array {
    // Find the smallest pool that can accommodate the size
    for (const poolSize of this.COMMON_SIZES) {
      if (poolSize >= size) {
        const pool = this.pools.get(poolSize);
        if (pool && pool.length > 0) {
          return pool.pop()!;
        }
        break;
      }
    }
    return new Uint8Array(size);
  }

  static release(buffer: Uint8Array): void {
    const size = buffer.length;
    for (const poolSize of this.COMMON_SIZES) {
      if (poolSize === size) {
        const pool = this.pools.get(poolSize);
        if (pool && pool.length < this.MAX_POOL_SIZE) {
          pool.push(buffer);
        }
        break;
      }
    }
  }
}

export class FrameCodec {
  private static readonly HEADER_SIZE = 4;
  private static readonly MAX_FRAME_SIZE = 1024 * 1024 - FrameCodec.HEADER_SIZE; // 1MB total per message (payload + header)

  static encode(frame: Frame): Uint8Array {
    const payloadLength = frame.payload.length;

    // Enforce frame size limits
    if (payloadLength > this.MAX_FRAME_SIZE) {
      throw new Error(
        `Frame payload too large: ${payloadLength} > ${this.MAX_FRAME_SIZE}`
      );
    }

    const totalSize = this.HEADER_SIZE + payloadLength;
    const result = BufferPool.acquire(totalSize);

    // Direct bit manipulation for maximum performance
    const word =
      (frame.streamId << 8) | (frame.type << 4) | (frame.flags & 0xf);
    result[0] = (word >>> 24) & 0xff;
    result[1] = (word >>> 16) & 0xff;
    result[2] = (word >>> 8) & 0xff;
    result[3] = word & 0xff;

    // Zero-copy payload assignment
    if (payloadLength > 0) {
      result.set(frame.payload, this.HEADER_SIZE);
    }

    return result.length === totalSize ? result : result.subarray(0, totalSize);
  }

  static encodeTyped(
    streamId: number,
    msgType: MessageType,
    flags: number,
    typeByte: number,
    payload: Uint8Array
  ): Uint8Array {
    const payloadLength = 1 + payload.length;
    if (payloadLength > this.MAX_FRAME_SIZE) {
      throw new Error(
        `Frame payload too large: ${payloadLength} > ${this.MAX_FRAME_SIZE}`
      );
    }
    const totalSize = this.HEADER_SIZE + payloadLength;
    const result = BufferPool.acquire(totalSize);
    const word = (streamId << 8) | (msgType << 4) | (flags & 0xf);
    result[0] = (word >>> 24) & 0xff;
    result[1] = (word >>> 16) & 0xff;
    result[2] = (word >>> 8) & 0xff;
    result[3] = word & 0xff;
    result[FrameCodec.HEADER_SIZE] = typeByte & 0xff;
    if (payload.length > 0) {
      result.set(payload, FrameCodec.HEADER_SIZE + 1);
    }
    return result.length === totalSize ? result : result.subarray(0, totalSize);
  }

  static decode(data: Uint8Array): Frame {
    if (data.length < FrameCodec.HEADER_SIZE) {
      throw new Error(
        `Invalid frame: too short (${data.length} < ${FrameCodec.HEADER_SIZE})`
      );
    }

    // Direct bit manipulation for decoding
    const word =
      (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;

    const streamId = word >>> 8;
    const typeAndFlags = word & 0xff;
    const type = (typeAndFlags >>> 4) as MessageType;
    const flags = typeAndFlags & 0xf;

    // Zero-copy payload extraction
    const payload =
      data.length > FrameCodec.HEADER_SIZE
        ? data.subarray(FrameCodec.HEADER_SIZE)
        : new Uint8Array(0);

    return { streamId, type, flags, payload };
  }

  static releaseBuffer(buffer: Uint8Array): void {
    BufferPool.release(buffer);
  }

  static getMaxPayloadSize(): number {
    return FrameCodec.MAX_FRAME_SIZE;
  }
}

export class Stream {
  private _onData?: Emitter<Uint8Array>;
  private _onClose?: Emitter<void>;
  private _onError?: Emitter<string>;
  private _disposed = false;
  private _id: number;

  constructor(
    id: number,
    private send: (frame: Frame) => void,
    private sendTypedCb?: (
      id: number,
      flags: number,
      typeByte: number,
      payload: Uint8Array
    ) => void
  ) {
    this._id = id;
  }

  public get id(): number {
    return this._id;
  }

  // Lazy initialization of event emitters
  public get onData() {
    if (!this._onData) {
      this._onData = new Emitter<Uint8Array>();
    }
    return this._onData.event;
  }

  public get onClose() {
    if (!this._onClose) {
      this._onClose = new Emitter<void>();
    }
    return this._onClose.event;
  }

  public get onError() {
    if (!this._onError) {
      this._onError = new Emitter<string>();
    }
    return this._onError.event;
  }

  write(data: Uint8Array, isFirst = false): void {
    if (this._disposed) {
      throw new Error(`Cannot write to disposed stream ${this.id}`);
    }

    const maxPayload = FrameCodec.getMaxPayloadSize();
    if (data.length <= maxPayload) {
      this.send({
        streamId: this.id,
        type: MessageType.DATA,
        flags: isFirst ? Flag.NEW : 0,
        payload: data,
      });
      return;
    }

    // Split into chunks to respect per-message size limits
    let offset = 0;
    let firstChunk = true;
    while (offset < data.length) {
      const remaining = data.length - offset;
      const chunkSize = remaining > maxPayload ? maxPayload : remaining;
      const chunk = data.subarray(offset, offset + chunkSize);

      this.send({
        streamId: this.id,
        type: MessageType.DATA,
        flags: isFirst && firstChunk ? Flag.NEW : 0,
        payload: chunk,
      });

      offset += chunkSize;
      firstChunk = false;
    }
  }

  writeTyped(typeByte: number, data: Uint8Array, isFirst = false): void {
    if (this._disposed) {
      throw new Error(`Cannot write to disposed stream ${this.id}`);
    }
    if (!this.sendTypedCb) {
      const merged = new Uint8Array(1 + data.length);
      merged[0] = typeByte & 0xff;
      if (data.length) merged.set(data, 1);
      this.write(merged, isFirst);
      return;
    }
    const maxPayload = FrameCodec.getMaxPayloadSize() - 1;
    if (data.length <= maxPayload) {
      this.sendTypedCb(this.id, isFirst ? Flag.NEW : 0, typeByte, data);
      return;
    }
    let offset = 0;
    let firstChunk = true;
    while (offset < data.length) {
      const remaining = data.length - offset;
      const chunkSize = remaining > maxPayload ? maxPayload : remaining;
      const chunk = data.subarray(offset, offset + chunkSize);
      this.sendTypedCb(
        this.id,
        isFirst && firstChunk ? Flag.NEW : 0,
        typeByte,
        chunk
      );
      offset += chunkSize;
      firstChunk = false;
    }
  }

  close(): void {
    if (this._disposed) return;

    this.send({
      streamId: this.id,
      type: MessageType.CLOSE,
      flags: 0,
      payload: new Uint8Array(0),
    });

    this._dispose();
  }

  error(message: string): void {
    if (this._disposed) return;

    this.send({
      streamId: this.id,
      type: MessageType.ERROR,
      flags: 0,
      payload: new TextEncoder().encode(message),
    });
  }

  // Internal method called by multiplexer
  _handleFrame(frame: Frame): void {
    if (this._disposed) return;

    switch (frame.type) {
      case MessageType.DATA:
        this._onData?.emit(frame.payload);
        break;
      case MessageType.CLOSE:
        this._onClose?.emit();
        this._dispose();
        break;
      case MessageType.ERROR:
        const error = new TextDecoder().decode(frame.payload);
        this._onError?.emit(error);
        this._dispose();
        break;
    }
  }

  private _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._onData?.dispose();
    this._onClose?.dispose();
    this._onError?.dispose();

    this._onData = undefined;
    this._onClose = undefined;
    this._onError = undefined;
  }

  // Reset stream for reuse (stream pooling)
  _reset(
    newId: number,
    newSend: (frame: Frame) => void,
    newSendTyped?: (
      id: number,
      flags: number,
      typeByte: number,
      payload: Uint8Array
    ) => void
  ): void {
    this._dispose();
    this._id = newId;
    this.send = newSend;
    this.sendTypedCb = newSendTyped;
    this._disposed = false;
  }

  public get createdByClient(): boolean {
    return this.id % 2 === 1;
  }

  public get disposed(): boolean {
    return this._disposed;
  }
}

class StreamPool {
  private static readonly MAX_POOL_SIZE = 200;
  private static pool: Stream[] = [];

  static acquire(
    id: number,
    send: (frame: Frame) => void,
    sendTyped?: (
      id: number,
      flags: number,
      typeByte: number,
      payload: Uint8Array
    ) => void
  ): Stream {
    const stream = this.pool.pop();
    if (stream) {
      stream._reset(id, send, sendTyped);
      return stream;
    }
    return new Stream(id, send, sendTyped);
  }

  static release(stream: Stream): void {
    // Allow pooling regardless of disposed state; _reset() reinitializes safely.
    if (this.pool.length < this.MAX_POOL_SIZE) {
      this.pool.push(stream);
    }
  }
}

export interface MultiplexerOptions {
  send: (array: Uint8Array) => void;
  isClient?: boolean;
  initialNextStreamID?: number;
  releaseAfterSend?: boolean;
}

/**
 * High-performance multiplexer with optimized stream management and batching
 */
export default class Multiplexer {
  private readonly _onNextStreamIDChange = new Emitter<number>();
  public readonly onNextStreamIDChange = this._onNextStreamIDChange.event;
  private readonly _onStream = new Emitter<Stream>();
  public readonly onStream = this._onStream.event;

  // Use sparse array for O(1) stream access
  private streams: (Stream | undefined)[] = [];
  private streamCount = 0;
  private nextStreamId = 1;
  private readonly send: (array: Uint8Array) => void;
  private readonly releaseAfterSend: boolean;

  constructor(opts: MultiplexerOptions) {
    // Client uses odd IDs, server uses even
    this.nextStreamId = opts.initialNextStreamID ?? (opts.isClient ? 1 : 2);
    this.send = opts.send;
    this.releaseAfterSend = !!opts.releaseAfterSend;
  }

  getStream(id: number): Stream | undefined {
    return this.streams[id];
  }

  createStream(id?: number): Stream {
    if (id === undefined) {
      id = this.nextStreamId;
      this.nextStreamId += 2;
      this._onNextStreamIDChange.emit(this.nextStreamId);
    }

    // Check if stream already exists
    const existingStream = this.streams[id];
    if (existingStream && !existingStream.disposed) {
      throw new Error(`Stream ${id} already exists`);
    }

    const stream = StreamPool.acquire(
      id,
      (frame) => this.sendFrame(frame),
      (sid, flags, typeByte, payload) =>
        this.sendFrameTyped(sid, typeByte, flags, payload)
    );
    this.streams[id] = stream;
    this.streamCount++;
    return stream;
  }

  private sendFrame(frame: Frame): void {
    const encoded = FrameCodec.encode(frame);
    try {
      this.send(encoded);
    } finally {
      if (this.releaseAfterSend) {
        FrameCodec.releaseBuffer(encoded);
      }
    }
  }

  private sendFrameTyped(
    streamId: number,
    appTypeByte: number,
    flags: number,
    payload: Uint8Array
  ): void {
    const encoded = FrameCodec.encodeTyped(
      streamId,
      MessageType.DATA,
      flags,
      appTypeByte,
      payload
    );
    try {
      this.send(encoded);
    } finally {
      if (this.releaseAfterSend) {
        FrameCodec.releaseBuffer(encoded);
      }
    }
  }

  public handleMessage(data: Uint8Array): void {
    this.handleFrame(FrameCodec.decode(data));
  }

  private handleFrame(frame: Frame): void {
    let stream = this.streams[frame.streamId];

    // Create stream if it doesn't exist (handles reinitialization scenarios)
    if (!stream || stream.disposed) {
      stream = StreamPool.acquire(
        frame.streamId,
        (frame) => this.sendFrame(frame),
        (sid, flags, typeByte, payload) =>
          this.sendFrameTyped(sid, typeByte, flags, payload)
      );
      this.streams[frame.streamId] = stream;
      this.streamCount++;
      this._onStream.emit(stream);
    }

    stream._handleFrame(frame);

    // Clean up closed streams
    if (frame.type === MessageType.CLOSE || frame.type === MessageType.ERROR) {
      this.streams[frame.streamId] = undefined;
      this.streamCount--;
      StreamPool.release(stream);
    }
  }

  /**
   */

  /**
   * Get current stream count for monitoring
   */
  get activeStreamCount(): number {
    return this.streamCount;
  }

  /**
   * Dispose of the multiplexer and clean up resources
   */
  dispose(): void {
    // Clean up all streams
    for (const stream of this.streams) {
      if (stream && !stream.disposed) {
        stream.close();
        StreamPool.release(stream);
      }
    }

    this.streams.length = 0;
    this.streamCount = 0;

    this._onNextStreamIDChange.dispose();
    this._onStream.dispose();
  }
}
