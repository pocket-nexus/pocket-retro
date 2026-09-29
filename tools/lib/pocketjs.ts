/** Locates the PocketJS checkout and loads the MicroTS compiler from it. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/** `POCKETJS_ROOT`, or a checkout next to this repository at ../pocketjs. */
export function pocketjsRoot(): string {
  const root = resolve(process.env.POCKETJS_ROOT ?? resolve(ROOT, "../pocketjs"));
  if (!existsSync(resolve(root, "microts/compiler/aot-model-frontend.ts"))) {
    throw new Error(`PocketJS checkout not found at ${root}; set POCKETJS_ROOT`);
  }
  return root;
}

type Frontend = typeof import("../../../pocketjs/microts/compiler/aot-model-frontend.ts");
type Codegen = typeof import("../../../pocketjs/microts/compiler/aot-model-codegen.ts");

export async function microts(): Promise<{
  analyzeModel: Frontend["analyzeModel"];
  generateModelRust: Codegen["generateModelRust"];
}> {
  const root = pocketjsRoot();
  const frontend: Frontend = await import(resolve(root, "microts/compiler/aot-model-frontend.ts"));
  const codegen: Codegen = await import(resolve(root, "microts/compiler/aot-model-codegen.ts"));
  return { analyzeModel: frontend.analyzeModel, generateModelRust: codegen.generateModelRust };
}
