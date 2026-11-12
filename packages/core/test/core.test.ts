import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { branchNameFromTitle, CardSchema, loadBoard, moveCard, saveBoard, TransitionError } from "../src/index.js";

const base = () =>
  CardSchema.parse({ id: "1", title: "123", repo: "/r", createdAt: "t", updatedAt: "t" });

describe("branchNameFromTitle", () => {
  it("keeps numeric titles", () => expect(branchNameFromTitle("1234")).toBe("1234"));
  it("replaces spaces with underscores", () =>
    expect(branchNameFromTitle("tarefa 123")).toBe("tarefa_123"));
  it("strips invalid ref characters", () =>
    expect(branchNameFromTitle("fix: a~b^c?")).toBe("fix_abc"));
  it("supports templates", () =>
    expect(branchNameFromTitle("42", "feat/{title}")).toBe("feat/42"));
  it("throws when nothing valid remains", () =>
    expect(() => branchNameFromTitle("...")).toThrow());
});

describe("state machine", () => {
  it("moves queue -> planning and sets planningStep", () => {
    const c = moveCard(base(), "planning");
    expect(c.status).toBe("planning");
    expect(c.planningStep).toBe("scope");
  });
  it("blocks doing without approved plan", () => {
    expect(() => moveCard(moveCard(base(), "planning"), "doing")).toThrow(TransitionError);
  });
  it("allows queue -> doing when planSkipped", () => {
    const c = moveCard({ ...base(), planSkipped: true }, "doing");
    expect(c.status).toBe("doing");
  });
  it("validation <-> doing loop does not need re-approval", () => {
    const doing = moveCard({ ...base(), planSkipped: true }, "doing");
    const val = moveCard(doing, "validation");
    expect(val.substatus).toBe("waiting-user");
    expect(moveCard(val, "doing").status).toBe("doing");
  });
  it("validation/doing -> planning resets approval and restarts at extras, then needs a new plan to return to doing", () => {
    const approved = moveCard({ ...base(), planApproved: true, branch: "1" }, "doing");
    for (const from of [approved, moveCard(approved, "validation")]) {
      const back = moveCard(from, "planning");
      expect(back.planningStep).toBe("extras");
      expect(back.planApproved).toBe(false);
      expect(back.planSkipped).toBe(false);
      expect(back.branch).toBe("1");
      expect(() => moveCard(back, "doing")).toThrow(TransitionError);
      expect(moveCard({ ...back, planApproved: true }, "doing").status).toBe("doing");
    }
  });
  it("moving a blocked card clears the block", () => {
    const blocked = { ...base(), planSkipped: true, substatus: "blocked" as const, blockReason: "which rule?" };
    const moved = moveCard(blocked, "doing");
    expect(moved.substatus).toBe("working");
    expect(moved.blockReason).toBeUndefined();
    const back = moveCard({ ...blocked, status: "planning" }, "queue");
    expect(back.substatus).toBeUndefined();
    expect(back.blockReason).toBeUndefined();
  });
  it("parks cards in the backlog, which only leads back to the queue", () => {
    const parked = moveCard(base(), "backlog");
    expect(parked.status).toBe("backlog");
    expect(() => moveCard(parked, "planning")).toThrow(TransitionError);
    expect(() => moveCard(parked, "doing")).toThrow(TransitionError);
    expect(moveCard(parked, "queue").status).toBe("queue");
    expect(() => moveCard({ ...base(), status: "planning" }, "backlog")).toThrow(TransitionError);
  });
  it("rejects illegal jumps", () => {
    expect(() => moveCard(base(), "validation")).toThrow(TransitionError);
  });
});

describe("storage", () => {
  it("round-trips and survives concurrent saves", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
    const file = path.join(dir, "board.json");
    expect((await loadBoard(file)).cards).toEqual([]);
    const board = { version: 1 as const, cards: [base()] };
    await Promise.all(Array.from({ length: 20 }, () => saveBoard(file, board)));
    expect((await loadBoard(file)).cards).toHaveLength(1);
  });
});
