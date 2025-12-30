import "ai";
import type { UIMessage, UIMessageStreamWriter } from "ai";

declare module "ai" {
  interface ToolCallOptions<T extends UIMessage = UIMessage> {
    // We inject the data stream into the tool execution
    // options to allow for streaming of data to the user.
    //
    // It's cleaner than piping it to every toolset.
    messageStream?: UIMessageStreamWriter<T>;
  }
}
