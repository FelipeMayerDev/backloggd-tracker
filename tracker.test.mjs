import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick, toSession, folderNames, pathNames, normaliseTitle, identify, parseLink } from "./tracker.mjs";

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
// Library folders.
assert.deepEqual(folderNames("D:\\Stuff\\Control\\control_dx12.exe"), []); // no library folder: needs the Game Bar signal
assert.deepEqual(folderNames("C:\\Games e Jogos\\Control Resonant\\CONTROLResonant.exe"), ["Control Resonant"]);
assert.deepEqual(folderNames("C:\\Program Files\\Epic Games\\Launcher\\Portal\\x.exe"), []);
assert.deepEqual(folderNames("C:\\Riot Games\\VALORANT\\live\\VALORANT.exe"), ["VALORANT"]);
assert.deepEqual(folderNames("Z:\\home\\me\\Games\\Hades\\Hades.exe"), ["Hades"]); // Wine path
assert.deepEqual(folderNames("C:\\Windows\\explorer.exe"), []);

// Folder names worth looking up for a game Windows flagged, deepest first, minus system/engine folders.
assert.deepEqual(
  pathNames("C:\\Program Files (x86)\\DODI-Repacks\\Lies of P\\LiesofP\\Binaries\\Win64\\LOP-Win64-Shipping.exe"),
  ["LiesofP", "Lies of P", "DODI-Repacks"]);
assert.deepEqual(
  pathNames("C:\\Users\\Focky\\Downloads\\ELDEN RING NIGHTREIGN\\ELDEN RING NIGHTREIGN\\nightreign.exe"),
  ["ELDEN RING NIGHTREIGN", "ELDEN RING NIGHTREIGN"]);

// Inside a library, never climb above it (no "Steam" from Program Files (x86)\Steam).
assert.deepEqual(
  pathNames("C:\\Program Files (x86)\\Steam\\steamapps\\common\\EdithFinch\\FinchGame\\Binaries\\Win64\\FinchGame.exe"),
  ["FinchGame", "EdithFinch"]);

// Steam: the appmanifest name wins over the install folder name.
const lib = join(mkdtempSync(join(tmpdir(), "bt-")), "steamapps");
mkdirSync(join(lib, "common", "DarkSoulsIII", "Game"), { recursive: true });
writeFileSync(join(lib, "appmanifest_374320.acf"), '"AppState"\n{\n\t"name"\t\t"DARK SOULS™ III"\n\t"installdir"\t\t"DarkSoulsIII"\n}');
assert.deepEqual(folderNames(join(lib, "common", "DarkSoulsIII", "Game", "DarkSoulsIII.exe")), ["DARK SOULS™ III"]);

// identify(): emulators, launchers and unflagged apps are never looked up.
const asked = [];
const fake = async (name) => { asked.push(name); return name === "Xenia" || name === "Steam" ? { id: 9, title: name } : null; };
assert.equal(await identify({ path: "D:\\Emuladores\\Xenia\\xenia_canary.exe", title: "Xenia", isGame: true }, fake), null);
assert.equal(await identify({ path: "C:\\Riot Games\\League of Legends\\LeagueClientUx.exe", title: "", isGame: true }, fake), null);
assert.equal(await identify({ path: "C:\\Program Files\\Parsec\\parsecd.exe", title: "Parsec", isGame: false }, fake), null);
assert.deepEqual(asked, []);

// Toast button links.
assert.deepEqual(parseLink("backloggd-tracker:answer?ok=1&key=ab12cd34ef"), { key: "ab12cd34ef", yes: true });
assert.deepEqual(parseLink("backloggd-tracker:answer?ok=0&key=ab12cd34ef/"), { key: "ab12cd34ef", yes: false });
assert.equal(parseLink("backloggd-tracker:open"), null);
assert.equal(parseLink("https://example.com/answer?ok=1&key=ab"), null);

console.log("ok");
