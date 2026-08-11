import { chatSystemPrompt } from "./chat";

describe("chatSystemPrompt modes", () => {
  const ctx = "[PROJECT CONTEXT]\nGoal: test project";

  it("main mode is the mentor/evaluator and is the default", () => {
    const main = chatSystemPrompt({ contextBlock: ctx, mode: "main" });
    expect(main).toContain("mentor");
    expect(main).toContain("Do NOT blindly agree");
    expect(main).toContain(ctx);
    expect(chatSystemPrompt({ contextBlock: ctx })).toBe(main);
  });

  it("pop mode is the assistant, not an evaluator, with context", () => {
    const pop = chatSystemPrompt({ contextBlock: ctx, mode: "pop" });
    expect(pop).toContain("You are POP");
    expect(pop).toContain("NOT a project evaluator");
    expect(pop).toContain(ctx);
    expect(pop).not.toContain("Do NOT blindly agree");
  });

  it("vision/attachment notes appear when enabled", () => {
    const p = chatSystemPrompt({ contextBlock: "", mode: "main", visionEnabled: true, hasAttachments: true });
    expect(p).toContain("vision capability");
    expect(p).toContain("attached files");
  });
});
