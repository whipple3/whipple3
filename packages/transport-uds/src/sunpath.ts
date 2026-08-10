import { resolve } from "node:path";

/**
 * sun_path is 104 bytes on macOS, 108 on Linux (incl. NUL). A longer path binds fine
 * RELATIVE but the kernel truncates it for absolute-path clients, who then see a
 * baffling ENOTSOCK. Enforce the strictest budget on the RESOLVED path, both ends,
 * before any syscall. (found by the first live /audit run)
 */
const SUN_PATH_BUDGET = 103;

export const assertUdsPath = (socketPath: string): string => {
  const abs = resolve(socketPath);
  const bytes = Buffer.byteLength(abs, "utf8");
  if (bytes > SUN_PATH_BUDGET)
    throw new Error(
      `socket path resolves to ${bytes} bytes (${abs}) — UDS sun_path allows ~${SUN_PATH_BUDGET}; ` +
        "use a shorter path",
    );
  return abs;
};

/** Human explanations for the three ways a UDS dial dies. */
export const explainDialError = (abs: string, e: NodeJS.ErrnoException): string => {
  switch (e.code) {
    case "ENOENT":
      return `no board socket at ${abs} — is \`whipple3 serve\` running?`;
    case "ECONNREFUSED":
      return `${abs} exists but nothing is listening — stale socket from a dead serve; remove it and restart serve`;
    case "ENOTSOCK":
      return `${abs} is not a socket — a stray file, or a client path truncated by the sun_path limit; shorten the path or remove the file`;
    default:
      return `board connection error: ${e.message}`;
  }
};
