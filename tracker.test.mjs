import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick, toSession, candidatesFor, indexDiscord, normaliseTitle } from "./tracker.mjs";

const T = new Date("2026-10-19T20:00:00").getTime();
const min = 60_000;
const hades = { id: 1, title: "Hades" };

let r = tick(null, hades, T);
assert.ok(!r.ended);
r = tick(r.state, hades, T + 90 * min);
r = tick(r.state, null, T + 91 * min);
assert.deepEqual(toSession(r.ended), { game: "1", title: "Hades", date: "2026-10-19", hours: 1, minutes: 30 });
assert.equal(r.state, null);

// Switching games closes the first and opens the second.
r = tick({ id: 1, title: "A", start: T, last: T + 10 * min }, { id: 2, title: "B" }, T + 11 * min);
assert.equal(r.ended.title, "A");
assert.equal(r.state.title, "B");

// Blips under MIN_MINUTES are dropped; midnight crossing sets end_date.
assert.equal(toSession({ id: 1, title: "A", start: T, end: T + 2 * min }), null);
assert.equal(toSession({ id: 1, title: "A", start: T, end: T + 300 * min }).end_date, "2026-10-20");

// Detection.
assert.equal(normaliseTitle("ELDEN RING™"), normaliseTitle("Elden Ring"));
assert.equal(normaliseTitle("Hollow Knight: Silksong"), normaliseTitle("Hollow Knight Silksong"));
const index = indexDiscord([["Control", ["control/control_dx12.exe"]], ["Other", ["game.exe"]]]);
assert.deepEqual(candidatesFor("D:\\Stuff\\Control\\control_dx12.exe", index), ["Control"]);
assert.deepEqual(candidatesFor("D:\\Stuff\\NotControl\\control_dx12.exe", index), []); // suffix must match a whole folder
assert.deepEqual(candidatesFor("C:\\Games e Jogos\\Control Resonant\\CONTROLResonant.exe", index), ["Control Resonant"]);
assert.deepEqual(candidatesFor("C:\\Program Files\\Epic Games\\Launcher\\Portal\\x.exe", index), []);
assert.deepEqual(candidatesFor("C:\\Riot Games\\VALORANT\\live\\VALORANT.exe", index), ["VALORANT"]);
assert.deepEqual(candidatesFor("Z:\\home\\me\\Games\\Hades\\Hades.exe", index), ["Hades"]); // Wine path
assert.deepEqual(candidatesFor("C:\\Windows\\explorer.exe", index), []);
assert.deepEqual(candidatesFor("C:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe", index), []);

// Steam: the appmanifest name wins over the install folder name.
const lib = join(mkdtempSync(join(tmpdir(), "bt-")), "steamapps");
mkdirSync(join(lib, "common", "DarkSoulsIII", "Game"), { recursive: true });
writeFileSync(join(lib, "appmanifest_374320.acf"), '"AppState"\n{\n\t"name"\t\t"DARK SOULS™ III"\n\t"installdir"\t\t"DarkSoulsIII"\n}');
assert.deepEqual(candidatesFor(join(lib, "common", "DarkSoulsIII", "Game", "DarkSoulsIII.exe"), index), ["DARK SOULS™ III"]);

console.log("ok");
