import type { Card, Status } from "./model.js";

const TRANSITIONS: Record<Status, Status[]> = {
  backlog: ["queue"], // parked cards always come back through the queue
  queue: ["backlog", "planning", "doing"],
  planning: ["queue", "doing"],
  doing: ["validation", "planning"],
  validation: ["doing", "planning"],
};

export class TransitionError extends Error {}

/** Throws TransitionError if the card cannot move to `to`. */
export function assertCanMove(card: Card, to: Status): void {
  if (card.status === to) return;
  if (!TRANSITIONS[card.status].includes(to)) {
    throw new TransitionError(`Cannot move card "${card.title}" from ${card.status} to ${to}`);
  }
  if (card.status !== "validation" && to === "doing" && !card.planApproved && !card.planSkipped) {
    throw new TransitionError(
      `Card "${card.title}" needs an approved plan (or planSkipped) before moving to doing`,
    );
  }
}

/** Returns the card moved to `to`, applying the side effects of the transition. */
export function moveCard(card: Card, to: Status, now = new Date().toISOString()): Card {
  assertCanMove(card, to);
  const next: Card = { ...card, status: to, updatedAt: now };
  // moving the card resolves a block
  next.blockReason = undefined;
  if (card.substatus === "blocked") next.substatus = undefined;
  if (to === "planning") {
    if (card.status === "doing" || card.status === "validation") {
      // re-planning: the scope is already structured, and a new plan (or direct run) must be decided
      next.planningStep = "extras";
      next.planApproved = false;
      next.planSkipped = false;
    } else {
      next.planningStep = card.planningStep ?? "scope";
    }
  }
  if (to === "doing") {
    next.planningStep = undefined;
    next.substatus = "working";
  }
  if (to === "validation") next.substatus = "waiting-user";
  return next;
}
