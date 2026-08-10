import { err, ok, type Result } from "@whipple3/core";

/**
 * Board lifetime is a PARAMETER, never an assumption: nothing may hardcode
 * "session end ⇒ purge". Purge (Stage 2) is an explicit action gated by this policy —
 * not a side effect of a session ending, and never core's business. "persistent"
 * (multi-process boards) is reserved: the type admits it so persistence lands as
 * config, not refactor; the runtime rejects it until it exists. (SPEC §4.8)
 */
export type BoardLifetime = "ephemeral" | "persistent";

export interface PurgeError {
  readonly code: "PURGE_NOT_PERMITTED";
  readonly lifetime: BoardLifetime;
}

/**
 * Purge is allowed only when the lifetime policy says the board dies with the session.
 * A persistent board is shared beyond this process — discarding it here would destroy
 * state other sessions own, so the policy refuses as a value. (SPEC §4.8, ADR-009)
 */
export const checkPurge = (lifetime: BoardLifetime): Result<void, PurgeError> =>
  lifetime === "ephemeral" ? ok(undefined) : err({ code: "PURGE_NOT_PERMITTED", lifetime });
