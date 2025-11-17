import { type Tool, tool } from "ai";
import { Exa } from "exa-js";
import { z } from "zod";

export const createWebSearchTools = ({
  exaApiKey,
}: {
  exaApiKey: string;
}): { web_search: Tool } => {
  const exaClient = new Exa(exaApiKey);

  return {
    web_search: tool({
      description:
        "Perform a search query on the web, and retrieve the most relevant URLs/web data.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        const results = await exaClient.searchAndContents(query, {
          numResults: 5,
          type: "auto",
          text: {
            maxCharacters: 3000,
          },
          livecrawl: "preferred",
        });
        return results;
      },
    }),
  };
};
