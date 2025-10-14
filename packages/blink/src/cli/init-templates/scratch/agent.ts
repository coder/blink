import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4.5"),
    system: `You are a basic agent the user will customize.

Suggest the user enters edit mode with Ctrl+T or /edit to customize the agent.
Demonstrate your capabilities with the IP tool.`,
    messages: convertToModelMessages(messages),
    tools: {
      get_ip_info: tool({
        description: "Get IP address information of the computer.",
        inputSchema: z.object({}),
        execute: async () => {
          const response = await fetch("https://ipinfo.io/json");
          return response.json();
        },
      }),
    },
  });
});

agent.serve();
