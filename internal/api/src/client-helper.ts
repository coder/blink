import { safeParseJSON } from "@ai-sdk/provider-utils";
import {
  EventSourceParserStream,
  type EventSourceMessage,
} from "eventsource-parser/stream";
import { z } from "zod";
import {
  createAsyncIterableStream,
  type AsyncIterableStream,
} from "./util/async-iterable-stream";

export const assertResponseStatus = async <T extends number>(
  res: Response,
  status: T
): Promise<void> => {
  if (res.status !== status) {
    // Read the body.
    const body = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      // If JSON parsing failed, throw the full error.
      throw new Error(`Expected status ${status}, got ${res.status}: ${body}`);
    }

    // If we have a message field, use only that.
    if (parsed.message) {
      throw new Error(parsed.message, {
        cause: parsed.details,
      });
    }

    // Otherwise, throw the full error with body.
    throw new Error(`Expected status ${status}, got ${res.status}: ${body}`);
  }
};

export const schemaPaginatedRequest = z.object({
  per_page: z.number().int().positive().max(100).default(10).optional(),
  page: z.number().int().nonnegative().default(0).optional(),
});

/**
 * Creates an order_by schema for sortable endpoints.
 * Supports optional "-" prefix for descending order (e.g., "-created_at").
 *
 * @example
 * ```ts
 * const schema = schemaPaginatedRequest.extend({
 *   order_by: schemaOrderBy(["name", "created_at", "permission"]).optional(),
 * });
 * // Accepts: "name", "-name", "created_at", "-created_at", etc.
 * ```
 */
export const schemaOrderBy = <T extends readonly [string, ...string[]]>(
  fields: T
) => {
  const patterns = fields.flatMap((f) => [f, `-${f}`] as const);
  return z.enum(patterns as unknown as [string, ...string[]]);
};

/**
 * Parses an order_by value into field and direction.
 * @example
 * ```ts
 * parseOrderBy("name")       // { field: "name", direction: "asc" }
 * parseOrderBy("-created_at") // { field: "created_at", direction: "desc" }
 * ```
 */
export const parseOrderBy = <T extends string>(
  orderBy: T | undefined
): { field: string; direction: "asc" | "desc" } | undefined => {
  if (!orderBy) return undefined;
  if (orderBy.startsWith("-")) {
    return { field: orderBy.slice(1), direction: "desc" };
  }
  return { field: orderBy, direction: "asc" };
};

export const schemaPaginatedResponse = <T extends z.ZodType>(schema: T) =>
  z.object({
    has_more: z.boolean(),
    items: z.array(schema),
  });

export const schemaCursorPaginatedRequest = z.object({
  limit: z.number().int().positive().max(100).default(10).optional(),
  cursor: z.string().optional(),
});

export const schemaCursorPaginatedResponse = <T extends z.ZodType>(schema: T) =>
  z.object({
    next_cursor: z.string().nullable(),
    items: z.array(schema),
  });

export const schemaMetadata = z
  .any()
  .nullable()
  .refine(
    (data) => {
      return data ? Object.keys(data).length <= 16 : true;
    },
    {
      message: "Metadata must contain at most 16 keys",
    }
  );

export const nameFormat = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;

export const streamSSE = <T extends z.ZodType>(
  resp: Response,
  schema: T
): AsyncIterableStream<z.infer<T>> => {
  const parser = new EventSourceParserStream();
  if (!resp.body) {
    throw new Error("The stream endpoint did not return a body!");
  }
  resp.body
    .pipeThrough(new TextDecoderStream())
    .pipeTo(parser.writable)
    .catch((err) => {
      // It's all chill - the stream is just going to end.
    });
  return createEventStreamFromReadable(parser.readable, schema);
};

export const createEventStreamFromReadable = <T extends z.ZodType>(
  readable: ReadableStream<EventSourceMessage>,
  schema: T
): AsyncIterableStream<z.infer<T>> => {
  const transformedStream = readable.pipeThrough(
    new TransformStream<EventSourceMessage, z.infer<T>>({
      async transform(chunk, controller) {
        const result = await safeParseJSON({
          text: chunk.data,
        });
        if (!result.success) {
          controller.error(result.error);
          return;
        }
        const parsed = schema.safeParse({
          event: chunk.event,
          data: result.value,
        });
        if (!parsed.success) {
          controller.error(parsed.error);
          return;
        }
        controller.enqueue(parsed.data);
      },
    })
  );

  return createAsyncIterableStream<z.infer<T>>(transformedStream);
};
