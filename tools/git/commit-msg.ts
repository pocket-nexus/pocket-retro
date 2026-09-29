#!/usr/bin/env bun
/** Rejects a commit message whose header is not a Conventional Commits header. */
import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
const HEADER = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9][a-z0-9-/]*\\))?!?: \\S.*$`);

const file = process.argv[2];
if (!file) throw new Error("usage: commit-msg.ts <message-file>");
const header = readFileSync(file, "utf8")
  .split("\n")
  .find((line) => line.trim() && !line.startsWith("#"));

// Git generates these headers itself; they are not authored messages.
if (header && /^(Merge|Revert|fixup!|squash!) /.test(header)) process.exit(0);

if (!header || !HEADER.test(header) || header.length > 100) {
  console.error(`commit-msg: "${header ?? ""}" is not a Conventional Commits header.`);
  console.error(`Expected "type(scope): summary" with type in: ${TYPES.join(", ")}; at most 100 characters.`);
  process.exit(1);
}
