import { test, expect, describe, beforeEach } from "bun:test";
import Multiplexer, {
  FrameCodec,
  Stream,
  MessageType,
  Flag,
  type Frame,
} from "./multiplexer";

describe("FrameCodec", () => {
  test("should encode frame correctly", () => {
    const frame: Frame = {
      streamId: 0x123456,
      type: MessageType.DATA,
      flags: Flag.NEW,
      payload: new Uint8Array([1, 2, 3, 4]),
    };

    const encoded = FrameCodec.encode(frame);

    // Header should be 4 bytes + 4 bytes payload
    expect(encoded.length).toBe(8);

    // Check header bytes
    const view = new DataView(encoded.buffer);
    const word = view.getUint32(0, false);

    const extractedStreamId = word >>> 8;
    const extractedType = (word & 0xff) >>> 4;
    const extractedFlags = word & 0xf;

    expect(extractedStreamId).toBe(0x123456);
    expect(extractedType).toBe(MessageType.DATA);
    expect(extractedFlags).toBe(Flag.NEW);

    // Check payload
    expect(Array.from(encoded.slice(4))).toEqual([1, 2, 3, 4]);
  });

  test("should decode frame correctly", () => {
    const data = new Uint8Array(8);
    const view = new DataView(data.buffer);

    // Set header: streamId=0x123456, type=DATA, flags=NEW
    const streamId = 0x123456;
    const typeAndFlags = (MessageType.DATA << 4) | Flag.NEW;
    view.setUint32(0, (streamId << 8) | typeAndFlags, false);

    // Set payload
    data.set([1, 2, 3, 4], 4);

    const frame = FrameCodec.decode(data);

    expect(frame.streamId).toBe(0x123456);
    expect(frame.type).toBe(MessageType.DATA);
    expect(frame.flags).toBe(Flag.NEW);
    expect(Array.from(frame.payload)).toEqual([1, 2, 3, 4]);
  });

  test("should handle round-trip encoding/decoding", () => {
    const original: Frame = {
      streamId: 0xabcdef,
      type: MessageType.ERROR,
      flags: 0x5,
      payload: new TextEncoder().encode("test error message"),
    };

    const encoded = FrameCodec.encode(original);
    const decoded = FrameCodec.decode(encoded);

    expect(decoded.streamId).toBe(original.streamId);
    expect(decoded.type).toBe(original.type);
    expect(decoded.flags).toBe(original.flags);
    expect(decoded.payload).toEqual(original.payload);
  });

  test("should handle empty payload", () => {
    const frame: Frame = {
      streamId: 1,
      type: MessageType.CLOSE,
      flags: 0,
      payload: new Uint8Array(0),
    };

    const encoded = FrameCodec.encode(frame);
    expect(encoded.length).toBe(4); // Header only

    const decoded = FrameCodec.decode(encoded);
    expect(decoded.payload.length).toBe(0);
  });

  test("should handle maximum stream ID", () => {
    const frame: Frame = {
      streamId: 0xffffff, // 24-bit max
      type: MessageType.DATA,
      flags: 0xf, // 4-bit max
      payload: new Uint8Array([255]),
    };

    const encoded = FrameCodec.encode(frame);
    const decoded = FrameCodec.decode(encoded);

    expect(decoded.streamId).toBe(0xffffff);
    expect(decoded.flags).toBe(0xf);
  });
});

describe("Stream", () => {
  let sentFrames: Frame[];
  let stream: Stream;

  beforeEach(() => {
    sentFrames = [];
    stream = new Stream(123, (frame) => sentFrames.push(frame));
  });

  test("should send data frame", () => {
    const data = new Uint8Array([1, 2, 3]);
    stream.write(data);

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]!.streamId).toBe(123);
    expect(sentFrames[0]!.type).toBe(MessageType.DATA);
    expect(sentFrames[0]!.flags).toBe(0);
    expect(sentFrames[0]!.payload).toEqual(data);
  });

  test("should send data frame with NEW flag when isFirst=true", () => {
    const data = new Uint8Array([1, 2, 3]);
    stream.write(data, true);

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]!.flags).toBe(Flag.NEW);
  });

  test("should send close frame", () => {
    stream.close();

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]!.streamId).toBe(123);
    expect(sentFrames[0]!.type).toBe(MessageType.CLOSE);
    expect(sentFrames[0]!.flags).toBe(0);
    expect(sentFrames[0]!.payload.length).toBe(0);
  });

  test("should send error frame", () => {
    const errorMessage = "Something went wrong";
    stream.error(errorMessage);

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]!.streamId).toBe(123);
    expect(sentFrames[0]!.type).toBe(MessageType.ERROR);
    expect(sentFrames[0]!.flags).toBe(0);
    expect(new TextDecoder().decode(sentFrames[0]!.payload)).toBe(errorMessage);
  });

  test("should emit data event when receiving data frame", () => {
    const receivedData: Uint8Array[] = [];
    stream.onData((data) => {
      receivedData.push(data);
    });

    const payload = new Uint8Array([4, 5, 6]);
    stream._handleFrame({
      streamId: 123,
      type: MessageType.DATA,
      flags: 0,
      payload,
    });

    expect(receivedData).toHaveLength(1);
    expect(receivedData[0]).toEqual(payload);
  });

  test("should emit close event when receiving close frame", () => {
    let closeReceived = false;
    stream.onClose(() => {
      closeReceived = true;
    });

    stream._handleFrame({
      streamId: 123,
      type: MessageType.CLOSE,
      flags: 0,
      payload: new Uint8Array(0),
    });

    expect(closeReceived).toBe(true);
  });

  test("should emit error event when receiving error frame", () => {
    let receivedError = "";
    stream.onError((error) => {
      receivedError = error;
    });

    const errorMessage = "Remote error";
    stream._handleFrame({
      streamId: 123,
      type: MessageType.ERROR,
      flags: 0,
      payload: new TextEncoder().encode(errorMessage),
    });

    expect(receivedError).toBe(errorMessage);
  });

  test("should chunk large payloads based on max payload size and set NEW on first chunk only", () => {
    const sent: Frame[] = [];
    const s = new Stream(77, (frame) => sent.push(frame));
    const max = FrameCodec.getMaxPayloadSize();
    const total = max * 2 + Math.floor(max / 3);
    const data = new Uint8Array(total);
    for (let i = 0; i < total; i++) data[i] = i % 256;

    s.write(data, true);

    const expectedChunks = Math.ceil(total / max);
    expect(sent).toHaveLength(expectedChunks);

    // Validate each chunk length, flags, and content slice
    let offset = 0;
    sent.forEach((frame, idx) => {
      expect(frame.type).toBe(MessageType.DATA);
      expect(frame.streamId).toBe(77);
      expect(frame.flags).toBe(idx === 0 ? Flag.NEW : 0);
      const chunkLen = Math.min(max, total - offset);
      expect(frame.payload.length).toBe(chunkLen);
      // Validate content slice matches
      for (let j = 0; j < chunkLen; j++) {
        expect(frame.payload[j]).toBe(data[offset + j]!);
      }
      offset += chunkLen;
    });
    expect(offset).toBe(total);
  });
});

describe("Multiplexer", () => {
  let sentData: Uint8Array[];
  let clientMux: Multiplexer;
  let serverMux: Multiplexer;

  beforeEach(() => {
    sentData = [];
    clientMux = new Multiplexer({
      send: (data) => sentData.push(data),
      isClient: true,
    });
    serverMux = new Multiplexer({
      send: (data) => sentData.push(data),
      isClient: false,
    });
  });

  test("should create client streams with odd IDs", () => {
    const stream1 = clientMux.createStream();
    const stream2 = clientMux.createStream();
    const stream3 = clientMux.createStream();

    expect(stream1.id).toBe(1);
    expect(stream2.id).toBe(3);
    expect(stream3.id).toBe(5);
  });

  test("should create server streams with even IDs", () => {
    const stream1 = serverMux.createStream();
    const stream2 = serverMux.createStream();
    const stream3 = serverMux.createStream();

    expect(stream1.id).toBe(2);
    expect(stream2.id).toBe(4);
    expect(stream3.id).toBe(6);
  });

  test("should send frame data when stream writes", () => {
    const stream = clientMux.createStream();
    const data = new Uint8Array([1, 2, 3]);

    stream.write(data, true);

    expect(sentData).toHaveLength(1);
    const frame = FrameCodec.decode(sentData[0]!);
    expect(frame.streamId).toBe(stream.id);
    expect(frame.type).toBe(MessageType.DATA);
    expect(frame.flags).toBe(Flag.NEW);
    expect(frame.payload).toEqual(data);
  });

  test("should create incoming streams when receiving NEW flag", () => {
    const incomingStreams: Stream[] = [];
    serverMux.onStream((stream) => incomingStreams.push(stream));

    // Simulate client creating a stream and sending data
    const frame: Frame = {
      streamId: 1, // Client stream ID
      type: MessageType.DATA,
      flags: Flag.NEW,
      payload: new Uint8Array([1, 2, 3]),
    };

    const encoded = FrameCodec.encode(frame);
    serverMux.handleMessage(encoded);

    expect(incomingStreams).toHaveLength(1);
    expect(incomingStreams[0]!.id).toBe(1);
  });

  test("should route frames to existing streams", () => {
    const incomingStreams: Stream[] = [];
    const receivedData: Uint8Array[] = [];

    serverMux.onStream((stream) => {
      incomingStreams.push(stream);
      // Set up event listener immediately when stream is created
      stream.onData((data) => {
        receivedData.push(data);
      });
    });

    // Create incoming stream
    const newFrame: Frame = {
      streamId: 1,
      type: MessageType.DATA,
      flags: Flag.NEW,
      payload: new Uint8Array([1]),
    };
    serverMux.handleMessage(FrameCodec.encode(newFrame));

    // Send more data to the same stream
    const dataFrame: Frame = {
      streamId: 1,
      type: MessageType.DATA,
      flags: 0,
      payload: new Uint8Array([2, 3]),
    };
    serverMux.handleMessage(FrameCodec.encode(dataFrame));

    expect(receivedData).toHaveLength(2);
    expect(receivedData[0]).toEqual(new Uint8Array([1]));
    expect(receivedData[1]).toEqual(new Uint8Array([2, 3]));
  });

  test("should clean up streams on close", () => {
    const stream = clientMux.createStream();

    // Send some data to establish the stream
    stream.write(new Uint8Array([1]), true);

    // Simulate receiving a close frame
    const closeFrame: Frame = {
      streamId: stream.id,
      type: MessageType.CLOSE,
      flags: 0,
      payload: new Uint8Array(0),
    };
    clientMux.handleMessage(FrameCodec.encode(closeFrame));

    // Try to send data to a non-existent stream - it should not crash
    const dataFrame: Frame = {
      streamId: stream.id,
      type: MessageType.DATA,
      flags: 0,
      payload: new Uint8Array([2]),
    };
    expect(() =>
      clientMux.handleMessage(FrameCodec.encode(dataFrame))
    ).not.toThrow();
  });

  test("should clean up streams on error", () => {
    const stream = clientMux.createStream();

    // Send some data to establish the stream
    stream.write(new Uint8Array([1]), true);

    // Simulate receiving an error frame
    const errorFrame: Frame = {
      streamId: stream.id,
      type: MessageType.ERROR,
      flags: 0,
      payload: new TextEncoder().encode("stream error"),
    };
    clientMux.handleMessage(FrameCodec.encode(errorFrame));

    // Try to send data to a non-existent stream - it should not crash
    const dataFrame: Frame = {
      streamId: stream.id,
      type: MessageType.DATA,
      flags: 0,
      payload: new Uint8Array([2]),
    };
    expect(() =>
      clientMux.handleMessage(FrameCodec.encode(dataFrame))
    ).not.toThrow();
  });

  test("should create streams for unknown stream IDs and emit onStream event", () => {
    const incomingStreams: Stream[] = [];
    const receivedData: Uint8Array[] = [];

    serverMux.onStream((stream) => {
      incomingStreams.push(stream);
      stream.onData((data) => receivedData.push(data));
    });

    // Send frame to non-existent stream WITHOUT NEW flag (reinitialization scenario)
    const frame: Frame = {
      streamId: 999, // Non-existent stream
      type: MessageType.DATA,
      flags: 0, // No NEW flag
      payload: new Uint8Array([1, 2, 3]),
    };

    // Should create stream AND emit onStream event to handle reinitialization
    expect(() =>
      serverMux.handleMessage(FrameCodec.encode(frame))
    ).not.toThrow();
    expect(incomingStreams).toHaveLength(1); // onStream event emitted
    expect(incomingStreams[0]!.id).toBe(999);
    expect(receivedData).toHaveLength(1); // Data received and processed
    expect(receivedData[0]).toEqual(new Uint8Array([1, 2, 3]));

    // Subsequent frames to the same stream should work normally
    const frame2: Frame = {
      streamId: 999,
      type: MessageType.DATA,
      flags: 0,
      payload: new Uint8Array([4, 5, 6]),
    };

    expect(() =>
      serverMux.handleMessage(FrameCodec.encode(frame2))
    ).not.toThrow();
    expect(incomingStreams).toHaveLength(1); // No additional onStream events
    expect(receivedData).toHaveLength(2); // Data received and processed
    expect(receivedData[1]).toEqual(new Uint8Array([4, 5, 6]));
  });
});

describe("Integration Tests", () => {
  test("should handle client-server communication", () => {
    let clientToServer: Uint8Array[] = [];
    let serverToClient: Uint8Array[] = [];

    const client = new Multiplexer({
      send: (data) => clientToServer.push(data),
      isClient: true,
    });

    const server = new Multiplexer({
      send: (data) => serverToClient.push(data),
      isClient: false,
    });

    const receivedData: Uint8Array[] = [];

    // Set up client stream with data listener first
    const clientStream = client.createStream();
    clientStream.onData((data) => {
      receivedData.push(data);
    });

    // Set up server to echo data back
    server.onStream((serverStream) => {
      serverStream.onData((data) => {
        serverStream.write(data);
      });
    });

    // Client sends data
    const testData = new Uint8Array([1, 2, 3, 4]);
    clientStream.write(testData, true);

    // Forward client message to server
    expect(clientToServer).toHaveLength(1);
    server.handleMessage(clientToServer[0]!);

    // Forward server response to client
    expect(serverToClient).toHaveLength(1);
    client.handleMessage(serverToClient[0]!);

    // Verify client received the echo
    expect(receivedData).toHaveLength(1);
    expect(receivedData[0]).toEqual(testData);
  });

  test("should handle multiple concurrent streams", () => {
    let messages: Uint8Array[] = [];

    const client = new Multiplexer({
      send: (data) => messages.push(data),
      isClient: true,
    });

    const stream1 = client.createStream();
    const stream2 = client.createStream();
    const stream3 = client.createStream();

    stream1.write(new Uint8Array([1]), true);
    stream2.write(new Uint8Array([2]), true);
    stream3.write(new Uint8Array([3]), true);

    expect(messages).toHaveLength(3);

    // Verify each message has correct stream ID
    const frames = messages.map(FrameCodec.decode);
    expect(frames[0]!.streamId).toBe(1);
    expect(frames[0]!.payload).toEqual(new Uint8Array([1]));
    expect(frames[1]!.streamId).toBe(3);
    expect(frames[1]!.payload).toEqual(new Uint8Array([2]));
    expect(frames[2]!.streamId).toBe(5);
    expect(frames[2]!.payload).toEqual(new Uint8Array([3]));
  });

  test("client reinitialize scenario - server responds to reinitialized client", () => {
    let clientToServer: Uint8Array[] = [];
    let serverToClient: Uint8Array[] = [];

    // Step 1: Client sends data
    const client1 = new Multiplexer({
      send: (data) => clientToServer.push(data),
      isClient: true,
    });

    const server = new Multiplexer({
      send: (data) => serverToClient.push(data),
      isClient: false,
    });

    const clientStream = client1.createStream();
    const originalStreamId = clientStream.id;
    const testData = new Uint8Array([1, 2, 3]);

    clientStream.write(testData, true);

    // Server receives the data and remembers the stream
    expect(clientToServer).toHaveLength(1);
    let serverStream: Stream | null = null;
    server.onStream((stream) => {
      serverStream = stream;
    });
    server.handleMessage(clientToServer[0]!);
    expect(serverStream).not.toBeNull();
    expect(serverStream!.id).toBe(originalStreamId);

    // Step 2: Client reinitializes (loses in-memory state)
    const client2 = new Multiplexer({
      send: (data) => clientToServer.push(data),
      isClient: true,
    });

    // Step 3: Server sends response to the original stream ID
    const responseData = new Uint8Array([4, 5, 6]);
    serverStream!.write(responseData);

    expect(serverToClient).toHaveLength(1);

    // Step 4: Client can receive and process the payload even after reinitializing
    const receivedData: Uint8Array[] = [];
    const receivedStreams: Stream[] = [];

    // Set up listeners for any streams that get created
    client2.onStream((stream) => {
      receivedStreams.push(stream);
      stream.onData((data) => receivedData.push(data));
    });

    // Decode and verify the frame properties
    const frame = FrameCodec.decode(serverToClient[0]!);
    expect(frame.streamId).toBe(originalStreamId);
    expect(frame.type).toBe(MessageType.DATA);
    expect(frame.flags).toBe(0); // No NEW flag
    expect(frame.payload).toEqual(responseData);

    // Client handles the message - should create stream and emit onStream event
    expect(() => client2.handleMessage(serverToClient[0]!)).not.toThrow();

    // onStream event should be emitted to allow reinitialized client to reconnect
    expect(receivedStreams).toHaveLength(1);
    expect(receivedStreams[0]!.id).toBe(originalStreamId);
    expect(receivedData).toHaveLength(1);
    expect(receivedData[0]).toEqual(responseData);

    // Subsequent messages to the same stream should work normally
    serverStream!.write(new Uint8Array([7, 8, 9]));
    expect(serverToClient).toHaveLength(2);

    client2.handleMessage(serverToClient[1]!);
    // No additional onStream events, but data should be received
    expect(receivedStreams).toHaveLength(1);
    expect(receivedData).toHaveLength(2);
    expect(receivedData[1]).toEqual(new Uint8Array([7, 8, 9]));
  });
});
