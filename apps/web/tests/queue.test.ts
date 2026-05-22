import { describe, it, expect } from "vitest";
import { BRIEF_QUEUE, ITEM_QUEUE, SEEDANCE_POLL_QUEUE } from "../src/lib/queue";
import {
  BRIEF_QUEUE as O_BRIEF,
  ITEM_QUEUE as O_ITEM,
  SEEDANCE_POLL_QUEUE as O_POLL,
} from "@shri/orchestrator";

// Smoke test: queue names match the orchestrator-owned canonical constants.
// Both producer (web) and consumer (worker) must use the same names.
describe("queue name constants", () => {
  it("BRIEF_QUEUE matches @shri/orchestrator", () => {
    expect(BRIEF_QUEUE).toBe("shri:brief");
    expect(BRIEF_QUEUE).toBe(O_BRIEF);
  });
  it("ITEM_QUEUE matches @shri/orchestrator", () => {
    expect(ITEM_QUEUE).toBe("shri:item");
    expect(ITEM_QUEUE).toBe(O_ITEM);
  });
  it("SEEDANCE_POLL_QUEUE matches @shri/orchestrator", () => {
    expect(SEEDANCE_POLL_QUEUE).toBe("shri:seedance-poll");
    expect(SEEDANCE_POLL_QUEUE).toBe(O_POLL);
  });
});
