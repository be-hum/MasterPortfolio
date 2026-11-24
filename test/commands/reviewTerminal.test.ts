import { describe, it, expect, vi } from "vitest";

class ExitPromptError extends Error { override name = "ExitPromptError"; }
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => { throw new ExitPromptError("User force closed the prompt with SIGINT"); }),
  checkbox: vi.fn(async () => { throw new ExitPromptError("User force closed the prompt with SIGINT"); }),
  confirm: vi.fn(async () => true),
}));

const { terminalIO } = await import("../../src/commands/review.js");

describe("terminal review IO (C1)", () => {
  it("treats Ctrl+C (ExitPromptError) as quit instead of crashing", async () => {
    expect(await terminalIO.answer("역할?")).toBeNull();
    expect(await terminalIO.decideMany([{ rel: "experiences/a.md", label: "1. A" }])).toBeNull();
  });
});
