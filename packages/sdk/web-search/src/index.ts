import { tool } from "ai";
import { Exa } from "exa-js";
import { z } from "zod";

/**
 * Returns an Exa client that is authenticated with EXA_API_KEY
 * or falls back to using the Blink API with passthrough billing.
 *
 * Use this to make your own search tools with Exa.
 */
export const exa = () => {
  let exaClient: Exa;
  // We'd prefer to have users set their own keys, but we proxy the Exa API
  // with passthrough billing so users don't have to sign up for an Exa account.
  if (process.env.EXA_API_KEY) {
    exaClient = new Exa(process.env.EXA_API_KEY);
  } else if (process.env.BLINK_INVOCATION_AUTH_TOKEN) {
    exaClient = new Exa(
      process.env.BLINK_INVOCATION_AUTH_TOKEN,
      "https://blink.so/api/tools/exa"
    );
  } else if (process.env.BLINK_TOKEN) {
    exaClient = new Exa(
      process.env.BLINK_TOKEN,
      "https://blink.so/api/tools/exa"
    );
  } else {
    console.warn(
      `You must set the EXA_API_KEY environment variable or be authenticated with Blink to use the web search SDK.`
    );

    throw new Error(
      "The EXA_API_KEY environment variable or a Blink token must be set to use the web search SDK."
    );
  }
  return exaClient;
};

export const tools = {
  web_search: tool({
    description:
      "Perform a search query on the web, and retrieve the most relevant URLs/web data.",
    inputSchema: z.object({
      query: z.string(),
    }),
    execute: async ({ query }) => {
      const results = await exa().searchAndContents(query, {
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
