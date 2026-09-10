import { describe, expect, it } from "vitest";
import { parseModelJSON } from "../src/generation/deepseek";

describe("DeepSeek response parsing", () => {
  it("parses plain structured output", () => {
    expect(parseModelJSON('{"answer":"OK"}')).toEqual({ answer: "OK" });
  });

  it("tolerates a single outer JSON fence", () => {
    expect(parseModelJSON('```json\n{"answer":"OK"}\n```')).toEqual({ answer: "OK" });
  });

  it("escapes unquoted control characters inside model strings", () => {
    expect(parseModelJSON('{"answer":"line one\nline two\tend"}')).toEqual({
      answer: "line one\nline two\tend",
    });
  });

  it("repairs a structurally incomplete model response", () => {
    expect(parseModelJSON('{"answer":"OK" "count":2}')).toEqual({
      answer: "OK",
      count: 2,
    });
  });
});
