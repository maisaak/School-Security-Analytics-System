import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/utils/incidentFeed.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createIncidentTracker } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const row = (id, second) => ({ id, detected_at: new Date(1700000000000 + second * 1000).toISOString() });
test("initial window is silent; fresh rows dispatch once in chronological order", () => {
  const track = createIncidentTracker(); assert.deepEqual(track([row(3,3),row(2,2)]), []);
  assert.deepEqual(track([row(5,5),row(4,4),row(3,3)]).map(r=>r.id), [4,5]);
  assert.deepEqual(track([row(5,5),row(4,4)]), []);
});
test("deletion and window reentry never replay old incidents", () => {
  const track = createIncidentTracker(); track([row(3,3),row(2,2)]); track([row(3,3)]);
  assert.deepEqual(track([row(3,3),row(2,2),row(1,1)]), []);
});
test("empty initial feed and reused IDs with a new timestamp are supported", () => {
  const track = createIncidentTracker(); track([]);
  assert.equal(track([row(1,1)]).length,1); assert.equal(track([row(1,2)]).length,1);
});
test("equal timestamps permit new IDs without duplicate announcements", () => {
  const track = createIncidentTracker(); track([row(1,1)]);
  assert.deepEqual(track([row(2,1),row(1,1)]).map(r=>r.id),[2]);
  assert.deepEqual(track([row(2,1),row(1,1)]),[]);
});
test("older delayed records and invalid timestamps do not trigger current alarms", () => {
  const track = createIncidentTracker(); track([row(5,5)]);
  assert.deepEqual(track([row(6,4), {id:7,detected_at:"broken"}]),[]);
  assert.deepEqual(track([row(8,6)]).map(r=>r.id),[8]);
});
test("bounded identity history does not replay older timestamps", () => {
  const track = createIncidentTracker(); track([]);
  for (let id=1;id<=2100;id++) assert.equal(track([row(id,id)]).length,1);
  assert.deepEqual(track([row(1,1),row(2100,2100)]),[]);
});
