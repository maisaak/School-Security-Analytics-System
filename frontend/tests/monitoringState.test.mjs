import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/utils/monitoringState.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { readMonitoringState } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
test("broken monitoring preferences restore safe defaults", () => {
  for (const value of [null,"broken","null","[]","false"]) assert.deepEqual(readMonitoringState(value),{columns:2,pinned:[],autofocus:false});
});
test("pins are positive safe integer IDs; flags are not coerced", () => {
  assert.deepEqual(readMonitoringState(JSON.stringify({columns:8,pinned:[1,"2",1,-1,0,2.5,null,3],autofocus:"true",extra:"ignored"})),{columns:8,pinned:[1,3],autofocus:false});
});
test("unsupported layouts reset without losing valid pins", () => {
  assert.deepEqual(readMonitoringState(JSON.stringify({columns:3,pinned:[4],autofocus:true})),{columns:2,pinned:[4],autofocus:true});
});
test("pin storage is bounded", () => {
  assert.equal(readMonitoringState(JSON.stringify({pinned:Array.from({length:1000},(_,i)=>i+1)})).pinned.length,256);
});
