import { assertResponseStatus } from "../client-helper";
import Client from "../client.browser";

export interface UploadFileResponse {
  id: string;
  url: string;
}

export default class Files {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async upload(file: File): Promise<UploadFileResponse> {
    const formData = new FormData();
    formData.append("file", file);
    const resp = await this.client.request("POST", "/api/files", formData);
    await assertResponseStatus(resp, 201);
    return resp.json();
  }

  public async get(id: string): Promise<File> {
    const resp = await this.client.request("GET", `/api/files/${id}`);
    await assertResponseStatus(resp, 200);
    return new File([await resp.blob()], "");
  }
}
