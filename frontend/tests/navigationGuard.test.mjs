import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/utils/navigationGuard.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { canLeaveWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
test("editor can cancel navigation and cleanup restores navigation", () => {
  globalThis.window = new EventTarget();
  assert.equal(canLeaveWorkspace(), true);
  const block = event => event.preventDefault();
  window.addEventListener("workspace-before-leave", block);
  assert.equal(canLeaveWorkspace(), false);
  window.removeEventListener("workspace-before-leave", block);
  assert.equal(canLeaveWorkspace(), true);
  delete globalThis.window;
});
