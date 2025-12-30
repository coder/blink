import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type UIMessage } from "ai";

// generateTitleFromUserMessages generates a title from the first user message.
export async function generateTitleFromMessages({
  env,
  messages,
}: {
  env: Cloudflare.Env;
  messages: Pick<UIMessage, "role" | "parts">[];
}) {
  const provider = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
  });
  let { text: title } = await generateText({
    model: provider.chat("gpt-4o"),
    system: `
- you will generate a short title based on the first message a user begins a conversation with
- ensure it is not more than 60 characters long
- the title should be a summary of the user's message
- do not use quotes or colons
- begin your answer directly with the content; do not prepend words like 'Summary', 'Hide', 'Fix', or 'Create'
- if the message includes instructions for an agent, attempt to be as descriptive as you can in what it's actually doing

Examples:
- user: make the background purple in example/repo
- title: "Purple background in example/repo"

- user: refactor the UI components to use MUI
- title: "MUI Refactor in example/repo"

- user: hey look through the example/repo repository and find all the places where we use postgres. then use that as a guide to refactor the app to use supabase.
- title: "Supabase Migration in example/repo"
  `,
    prompt: JSON.stringify(messages),
  });

  if (title.startsWith('"') && title.endsWith('"')) {
    title = title.slice(1, -1);
  }

  return title;
}
