import assert from "node:assert/strict";
import { tick, toSession } from "./tracker.mjs";

const T = new Date("2026-10-19T20:00:00").getTime();
const min = 60_000;

let r = tick(null, "Hades", T);
assert.ok(!r.ended);
r = tick(r.state, "Hades", T + 90 * min);
r = tick(r.state, null, T + 91 * min);
assert.deepEqual(toSession(r.ended), { game: "Hades", date: "2026-10-19", hours: 1, minutes: 30 });
assert.equal(r.state, null);

// Switching games closes the first and opens the second.
r = tick({ game: "A", start: T, last: T + 10 * min }, "B", T + 11 * min);
assert.equal(r.ended.game, "A");
assert.equal(r.state.game, "B");

// Blips under MIN_MINUTES are dropped; midnight crossing sets end_date.
assert.equal(toSession({ game: "A", start: T, end: T + 2 * min }), null);
assert.equal(toSession({ game: "A", start: T, end: T + 300 * min }).end_date, "2026-10-20");

console.log("ok");
