import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/archiveState.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { readArchivePresets, archiveRequest, emptyArchiveFilters, localIncidentDay } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("malformed local storage cannot crash archive", () => {
  for (const raw of ["null", "[]", "false", "broken", '{"bad":null}', '{"bad":{"from":3}}']) assert.deepEqual(readArchivePresets(raw), {});
});
test("presets accept only bounded string fields and remove unknown values", () => {
  const presets = readArchivePresets(JSON.stringify({ saved: { ...emptyArchiveFilters, camera: "12", extra: "ignored" } }));
  assert.deepEqual(presets.saved, { ...emptyArchiveFilters, camera: "12" });
});
test("archive date confidence and camera validation fail without RangeError", () => {
  for (const change of [{from: "invalid"}, {confidence: "NaN"}, {confidence: "101"}, {camera: "-1"}, {from:"2026-10-31T12:00",to:"2026-10-30T12:00"}]) assert.throws(() => archiveRequest({...emptyArchiveFilters,...change}, 0));
});
test("archive request retains zero confidence and exclusive end timestamp", () => {
  const result = archiveRequest({...emptyArchiveFilters, confidence: "0", to:"2026-10-30T12:00", camera:"2"},2);
  assert.equal(result.min_confidence, 0); assert.equal(result.offset, 200); assert.equal(result.camera_id, 2);
  assert.equal(result.date_to, new Date("2026-10-30T12:00").toISOString());
});
test("timeline invalid date has safe label", () => assert.equal(localIncidentDay("bad"), "Дата неизвестна"));
test("tampered preset enums and page values never reach the API", () => {
  assert.throws(() => archiveRequest({...emptyArchiveFilters, type:"unknown"},0));
  assert.throws(() => archiveRequest({...emptyArchiveFilters, status:"approved"},0));
  for (const page of [-1, .5, NaN, Infinity]) assert.throws(() => archiveRequest(emptyArchiveFilters,page));
});
