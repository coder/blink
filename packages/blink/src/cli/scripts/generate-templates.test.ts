import { expect, it } from "bun:test";
import { templates } from "../init-templates";
import { generateTemplates } from "../lib/templates";

it("templates are up to date", async () => {
  // if this test fails, run `bun run gen-templates` in `packages/blink`
  const generatedTemplates = await generateTemplates();
  expect(generatedTemplates).toEqual(templates);
});
