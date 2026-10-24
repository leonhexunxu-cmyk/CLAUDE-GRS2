import { test } from "node:test";
import assert from "node:assert/strict";
import { isHalloweenSeason, msUntilSeasonEnds } from "../src/season.js";

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

test("active through November 1, 2026 inclusive (local date)", () => {
  assert.equal(isHalloweenSeason(local(2026, 10, 24)), true);
  assert.equal(isHalloweenSeason(local(2026, 10, 31)), true);
  assert.equal(isHalloweenSeason(local(2026, 11, 1, 23)), true);
});

test("expires automatically after November 1, 2026", () => {
  assert.equal(isHalloweenSeason(local(2026, 11, 2, 0)), false);
  assert.equal(isHalloweenSeason(local(2027, 10, 31)), false);
  assert.equal(isHalloweenSeason(local(2026, 9, 30)), false);
});

test("an invalid date falls back to the normal interface", () => {
  assert.equal(isHalloweenSeason(new Date("not a date")), false);
  assert.equal(msUntilSeasonEnds(new Date(NaN)), null);
});

test("time remaining ends at local midnight starting Nov 2", () => {
  assert.equal(msUntilSeasonEnds(local(2026, 11, 1, 23)), 3600_000);
  assert.equal(msUntilSeasonEnds(local(2026, 11, 3)), null);
});
