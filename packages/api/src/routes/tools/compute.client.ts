import { Client as ComputeClient } from "@blink-sdk/compute-protocol/client";
import { z } from "zod";
import { assertResponseStatus } from "../../client-helper";
import Client from "../../client.browser";

const schemaTokenRequest = z.object({});

const schemaTokenResponse = z.object({
  id: z.string(),
  token: z.string(),
});

export type TokenResponse = z.infer<typeof schemaTokenResponse>;

export default class Compute {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Create a compute token. This can be used to serve a compute instance.
   *
   * @param request - The request body.
   * @returns The compute instance.
   */
  public async token(): Promise<TokenResponse> {
    const resp = await this.client.request("POST", "/api/tools/compute");
    await assertResponseStatus(resp, 201);
    return resp.json();
  }

  /**
   * connect to a compute instance.
   *
   * @param id - The ID of the compute instance.
   * @returns A compute client.
   */
  public async connect(id: string): Promise<ComputeClient> {
    const ws = this.client.websocket(`/api/tools/compute/connect?id=${id}`);
    const client = new ComputeClient({
      send: (message) => ws.send(message),
    });
    return client;
  }
}
