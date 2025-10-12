import { z } from "zod";
import {
  type Disposable,
  type NotificationMessage,
  type NotificationSchema,
  type RequestMessage,
  type RequestSchema,
  type ResponseMessage,
  ResponseSchema,
} from "./schema";

export interface ClientOptions {
  send: (message: string) => void;
  jwt?: string;
  requestTimeoutMS?: number;
}

export class Client {
  private notificationCallbacks: Map<
    keyof typeof NotificationSchema,
    NotificationCallback<any>[]
  > = new Map();
  private disposables: Disposable[] = [];
  private requestHandlers: Map<
    string,
    (
      payload?: z.infer<(typeof ResponseSchema)[keyof typeof ResponseSchema]>,
      error?: string
    ) => void
  > = new Map();
  private readonly send: (message: string) => void;
  private readonly jwt?: string;
  private readonly requestTimeoutMS?: number;

  public constructor({ send, jwt, requestTimeoutMS }: ClientOptions) {
    this.send = send;
    this.jwt = jwt;
    this.requestTimeoutMS = requestTimeoutMS;
  }

  // acceptMessage is called by a transport to accept a message.
  public handleMessage(message: string): void {
    if (typeof message !== "string") {
      return;
    }
    const parsed = JSON.parse(message) as
      | ResponseMessage<any>
      | NotificationMessage<any>;
    if ("id" in parsed) {
      // This is a response.
      const handler = this.requestHandlers.get(parsed.id);
      if (!handler) {
        // Maybe we should throw here?
        return;
      }
      handler(parsed.payload, parsed.error);
    } else if ("type" in parsed) {
      // This is a notification.
      this.notificationCallbacks.get(parsed.type)?.forEach((callback) => {
        callback(parsed.payload);
      });
    } else {
      return;
    }
  }

  public dispose(reason?: string): void {
    this.disposables.forEach((d) => d.dispose(reason));
  }

  public async request<T extends keyof typeof RequestSchema>(
    type: T,
    payload: z.infer<(typeof RequestSchema)[T]>,
    opts?: {
      signal?: AbortSignal;
    }
  ): Promise<z.infer<(typeof ResponseSchema)[T]>> {
    const id = crypto.randomUUID();

    let resolve: (value: z.infer<(typeof ResponseSchema)[T]>) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<z.infer<(typeof ResponseSchema)[T]>>(
      (res, rej) => {
        resolve = res;
        reject = rej;
      }
    );

    const disposable = {
      dispose: (reason?: string) => {
        cleanup();
        let message = "Client was disposed!";
        if (reason) {
          message += ` Reason: ${reason}`;
        }
        reject(new Error(message));
      },
    };
    this.disposables.push(disposable);

    let timeout: NodeJS.Timeout | undefined;
    if (this.requestTimeoutMS) {
      timeout = setTimeout(() => {
        reject(new Error("Request timed out"));
      }, this.requestTimeoutMS);
    }

    const cleanup = () => {
      this.disposables.splice(this.disposables.indexOf(disposable), 1);
      this.requestHandlers.delete(id);
      if (timeout) {
        clearTimeout(timeout);
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => {
        cleanup();
        reject(opts.signal?.reason);
      });
    }

    this.requestHandlers.set(id, (payload, error) => {
      cleanup();
      if (error) {
        return reject(new Error(error));
      }
      resolve(payload as z.infer<(typeof ResponseSchema)[T]>);
    });

    const req: RequestMessage<T> = { id, type, payload, jwt: this.jwt };
    this.send(JSON.stringify(req));
    return promise;
  }

  public onNotification<T extends keyof typeof NotificationSchema>(
    type: T,
    callback: NotificationCallback<T>
  ): Disposable {
    const callbacks = this.notificationCallbacks.get(type) ?? [];
    callbacks.push(callback);
    this.notificationCallbacks.set(type, callbacks);

    return {
      dispose: () => {
        const callbacks = this.notificationCallbacks.get(type) ?? [];
        const index = callbacks.indexOf(callback);
        if (index !== -1) {
          callbacks.splice(index, 1);
        }
      },
    };
  }
}

type NotificationCallback<T extends keyof typeof NotificationSchema> = (
  payload: z.infer<(typeof NotificationSchema)[T]>
) => void;
