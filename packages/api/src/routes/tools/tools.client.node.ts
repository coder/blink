import Client from "../../client.node";
import Compute from "./compute.client";

export default class Tools {
  private readonly client: Client;
  public readonly compute: Compute;

  public constructor(client: Client) {
    this.client = client;
    this.compute = new Compute(this.client);
  }
}
