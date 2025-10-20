import { describe, it, expect } from "bun:test";
import { generateTemplates } from "../lib/templates";
import { templates } from "../init-templates";

it("templates are up to date", async () => {
  // if this test fails, run `bun run gen-templates` in `packages/blink`
  const generatedTemplates = await generateTemplates();
  expect(generatedTemplates).toEqual(templates);
});
