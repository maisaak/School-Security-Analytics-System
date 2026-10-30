import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/cameraFilters.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { filterCameras } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const cameras = [
  { id: 1, name: "Вход", location: "Первый этаж", is_active: true, online: true, active_threats: [] },
  { id: 2, name: "Двор", location: "Улица", is_active: true, online: false, active_threats: [] },
  { id: 3, name: "Коридор", location: "Второй этаж", is_active: false, online: true, active_threats: ["weapon"] },
  { id: 4, name: "Холл", location: "Первый этаж", is_active: true, online: true, active_threats: ["dog"] },
];
const ids = (query, filter) => filterCameras(cameras, query, filter).map(camera => camera.id);

test("all cameras remain visible, including paused sources", () => assert.deepEqual(ids("", "all"), [1, 2, 3, 4]));
test("search matches Russian names and locations, ignoring case and surrounding whitespace", () => {
  assert.deepEqual(ids("  ВХОД  ", "all"), [1]);
  assert.deepEqual(ids("первый этаж", "all"), [1, 4]);
});
test("online and offline exclude paused cameras with stale status", () => {
  assert.deepEqual(ids("", "online"), [1, 4]);
  assert.deepEqual(ids("", "offline"), [2]);
});
test("threats exclude paused cameras with stale detections", () => assert.deepEqual(ids("", "threats"), [4]));
test("search and status combine without changing source order or mutating input", () => {
  const before = structuredClone(cameras);
  assert.deepEqual(ids("первый", "threats"), [4]);
  assert.deepEqual(ids("двор", "online"), []);
  assert.deepEqual(cameras, before);
});
