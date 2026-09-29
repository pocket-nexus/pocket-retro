import type { i32 as I32 } from "@pocketjs/framework/solid/std";

/** The value of a hex digit's character code, or -1 for other characters. */
export function hexDigit(code: I32): I32 {
  return code >= 48 && code <= 57
    ? code - 48
    : code >= 97 && code <= 102
      ? code - 87
      : code >= 65 && code <= 70
        ? code - 55
        : -1;
}
