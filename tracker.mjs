// Detects the game you're playing (Windows or Linux) and logs each session to Backloggd.
// Env: backloggd-mcp auth (BACKLOGGD_SESSION | BACKLOGGD_USERNAME/PASSWORD | BACKLOGGD_BROWSER_IMPORT=firefox).
import { readFileSync, writeFileSync, rmSync, appendFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { isSea } from "node:sea";
import { loadConfig } from "backloggd-mcp/dist/config.js";
import { HttpClient } from "backloggd-mcp/dist/http/client.js";
import { SessionManager } from "backloggd-mcp/dist/auth/session.js";
import { BackloggdApi } from "backloggd-mcp/dist/api/index.js";
import { writeTools } from "backloggd-mcp/dist/tools/write.js";

// Files live next to the script, or next to the .exe when built as a single executable.
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
try { process.loadEnvFile(here(".env")); } catch {}

// The .exe has no console window, so its output goes to tracker.log.
if (isSea()) {
  for (const k of ["log", "error"]) {
    console[k] = (...a) => appendFileSync(here("tracker.log"), `${new Date().toLocaleString("sv")} ${a.join(" ")}\n`);
  }
}

const POLL_MS = 60_000;
const MIN_MINUTES = Number(process.env.MIN_MINUTES ?? 5); // ignore launcher blips
const STATE = here("state.json");
const LOCK_PORT = 47613; // held while running, so a second copy can't double-log sessions

const day = (t) => new Date(t).toLocaleDateString("sv"); // YYYY-MM-DD, local time

// Pure transition on { id, title } games: returns the next state and the finished session, if any.
export function tick(state, game, now) {
  if (state?.id === game?.id) return { state: state && { ...state, last: now } };
  // End at the last poll that saw it, so downtime or restarts don't inflate the session.
  const ended = state && { ...state, end: state.last };
  return { state: game ? { ...game, start: now, last: now } : null, ended };
}

export function toSession({ id, title, start, end }) {
  const mins = Math.round((end - start) / 60_000);
  if (mins < MIN_MINUTES) return null;
  const s = { game: String(id), title, date: day(start), hours: Math.floor(mins / 60), minutes: mins % 60 };
  if (day(end) !== s.date) s.end_date = day(end);
  return s;
}

// ---------------------------------------------------------------- detection

// games.json: exe full path or exe name -> Backloggd title, or null to ignore it.
// The tracker adds every game it recognises here, so it doubles as the learned list.
const GAMES_FILE = here("games.json");
let GAMES = {};
try { GAMES = JSON.parse(readFileSync(GAMES_FILE, "utf8")); } catch {}
const lookup = () => new Map(Object.entries(GAMES).map(([k, v]) => [k.replace(/\\/g, "/").toLowerCase(), v]));
let known = lookup();

export function override(path) {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return known.has(p) ? known.get(p) : known.get(p.split("/").pop());
}

function learn(path, title) {
  // Re-read first so hand edits made while running survive, and never overwrite a file
  // that doesn't parse: that would wipe the user's entries.
  let current = {};
  try { current = JSON.parse(readFileSync(GAMES_FILE, "utf8")); } catch (e) {
    if (e.code !== "ENOENT") return console.error("games.json is invalid, not saving", title, e.message);
  }
  GAMES = { ...current, [path]: title };
  known = lookup();
  try { writeFileSync(GAMES_FILE, JSON.stringify(GAMES, null, 2)); } catch (e) { console.error("games.json:", e.message); }
}

// Always-running apps and launchers that sit in game folders (Windows flags some launchers as games).
const IGNORED = new Set([
  "wallpaper32.exe", "wallpaper64.exe", "steam.exe", "steamwebhelper.exe",
  "leagueclient.exe", "leagueclientux.exe", "riotclientservices.exe", "epicgameslauncher.exe",
  "battle.net.exe", "eadesktop.exe", "upc.exe", "ubisoftconnect.exe", "galaxyclient.exe",
]);
// Emulators: the process is the emulator, not the game, and some share names with games (Xenia).
const EMULATOR = /\/[^/]*emula/i;
// Folder names under a games directory that are never the game itself.
const GENERIC_DIRS = /^(launcher|client|bin|common|redist|_commonredist|tools|steamworks shared|steam linux runtime.*|proton.*)$/i;
// Path segments that never name a game: system folders and engine/build subfolders.
const NOT_A_TITLE = /^([a-z]:|users|program files( \(x86\))?|programdata|appdata|local|roaming|downloads|desktop|documents|home|binaries|win64|win32|x64|x86|bin|bin64|game|live|retail|content|engine|steamapps|common|steam)$|games|jogos|juegos/i;

export const normaliseTitle = (s) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Steam's appmanifest gives the official name for a steamapps/common/<installdir> folder.
const steamNames = new Map();
function steamName(libraryRoot, installdir) {
  const key = `${libraryRoot}|${installdir}`.toLowerCase();
  if (!steamNames.has(key)) {
    let name = installdir;
    try {
      for (const f of readdirSync(libraryRoot).filter((f) => /^appmanifest_\d+\.acf$/.test(f))) {
        const acf = readFileSync(`${libraryRoot}/${f}`, "utf8");
        if (/"installdir"\s+"([^"]+)"/.exec(acf)?.[1].toLowerCase() === installdir.toLowerCase()) {
          name = /"name"\s+"([^"]+)"/.exec(acf)?.[1] ?? installdir;
          break;
        }
      }
    } catch {}
    steamNames.set(key, name);
  }
  return steamNames.get(key);
}

// Names implied by a game library folder: steamapps/common/<X>, or <X> under any
// "games"/"jogos" directory (Epic Games\X, GOG Games\X, Riot Games\X, D:\Jogos\X).
// Being in such a folder is also one of the signals that a process is a game.
export function folderNames(path) {
  const parts = path.replace(/\\/g, "/").split("/");
  const out = [];
  for (let i = 0; i < parts.length - 2; i++) {
    const dir = parts[i].toLowerCase();
    const next = parts[i + 1];
    if (GENERIC_DIRS.test(next)) continue;
    if (dir === "common" && parts[i - 1]?.toLowerCase() === "steamapps") out.push(steamName(parts.slice(0, i).join("/"), next));
    else if (/games|jogos|juegos/.test(dir)) out.push(next);
  }
  return [...new Set(out)];
}

// Every folder on the path that could be the game's name, deepest first. Inside a game
// library only the folders below it count, so "...\\Steam\\steamapps\\common\\X" never yields "Steam".
export function pathNames(path) {
  const dirs = path.replace(/\\/g, "/").split("/").slice(0, -1);
  const root = dirs.findLastIndex((d, i) => /games|jogos|juegos/i.test(d) || (/^common$/i.test(d) && /^steamapps$/i.test(dirs[i - 1] ?? "")));
  return dirs
    .filter((d, i) => i > root && d && !NOT_A_TITLE.test(d) && !/^(users|home)$/i.test(dirs[i - 1] ?? "")) // skip the user name too
    .reverse();
}

// Running processes: { path, title (window), isGame (Windows' own Game Bar classification) }.
// Linux has neither, so it relies on game folders, games.json, and Wine/Proton exe paths in argv.
const PS_PROCESSES = "$g=@{};Get-ChildItem HKCU:\\System\\GameConfigStore\\Children -EA 0|%{$p=(Get-ItemProperty $_.PSPath).MatchedExeFullPath;if($p){$g[$p.ToLower()]=1}};" +
  "ConvertTo-Json -Compress -InputObject @(Get-Process|?{$_.Path}|%{@{path=$_.Path;title=$_.MainWindowTitle;isGame=$g.ContainsKey($_.Path.ToLower())}})";

function runningProcesses() {
  if (process.platform === "win32") {
    return JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", PS_PROCESSES],
      { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 26 }));
  }
  const out = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      for (const a of readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")) if (/[\\/]/.test(a)) out.push({ path: a, title: "", isGame: false });
    } catch {}
  }
  return out;
}

// Product name and description baked into a Windows exe.
function exeInfo(path) {
  if (process.platform !== "win32") return [];
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "$v=(Get-Item -LiteralPath $env:EXE -EA Stop).VersionInfo;ConvertTo-Json -Compress @($v.ProductName,$v.FileDescription)"],
      { encoding: "utf8", windowsHide: true, env: { ...process.env, EXE: path }, stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out).filter(Boolean);
  } catch { return []; }
}

// A process is only looked up when something says it's a game: games.json, Windows'
// Game Bar list, or a game library folder. A Backloggd title match alone isn't enough:
// apps like Steam, Parsec and Hydra share names with old games.
const identified = new Map(); // path -> game | null, for processes not yet in games.json
// `resolve` maps a name to its exact-match Backloggd game, or null.
export async function identify({ path, title, isGame }, resolve) {
  const base = path.replace(/\\/g, "/").split("/").pop().toLowerCase();
  if (IGNORED.has(base) || EMULATOR.test(path.replace(/\\/g, "/"))) return null;
  const listed = override(path);
  if (listed === null) return null;
  if (typeof listed === "string") return resolve(listed);
  if (identified.has(path)) return identified.get(path);

  const folders = folderNames(path);
  let game = null;
  if (isGame || folders.length) {
    // Library folder names (incl. Steam's official name) win; otherwise the longest
    // matching title, so "Clair Obscur Expedition 33" beats the exe's "Sandfall".
    for (const name of folders) if ((game = await resolve(name))) break;
    if (!game && isGame) {
      for (const name of new Set([title, ...exeInfo(path), ...pathNames(path)])) {
        const hit = await resolve(name);
        if (hit && (!game || hit.title.length > game.title.length)) game = hit;
      }
    }
  }
  identified.set(path, game);
  if (game) {
    learn(path, game.title);
    console.log(`recognised ${path} -> ${game.title} (${game.id})`);
    notify("Jogo reconhecido", `${game.title} foi adicionado ao games.json`);
  }
  return game;
}


// ---------------------------------------------------------------- notifications

// Windows toast via PowerShell's own app id; the XML goes through env to dodge quoting.
const TOAST_PS = "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;" +
  "$x=[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]::new();$x.LoadXml($env:TOAST);" +
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')" +
  ".Show([Windows.UI.Notifications.ToastNotification]::new($x))";

export function notify(title, text) {
  const done = (e) => e && console.error("notify:", e.message);
  if (process.platform !== "win32") return execFile("notify-send", ["-a", "Backloggd", title, text], done);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const TOAST = `<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(text)}</text></binding></visual></toast>`;
  execFile("powershell", ["-NoProfile", "-Command", TOAST_PS], { env: { ...process.env, TOAST }, windowsHide: true }, done);
}

// ---------------------------------------------------------------- main

async function main() {
  // The OS frees the port when the process dies, so there's no stale lock to clean up.
  const lock = createServer().unref();
  await new Promise((resolve) => lock.once("error", () => {
    console.error("tracker is already running");
    process.exit(0);
  }).listen(LOCK_PORT, "127.0.0.1", resolve));

  console.log("tracker started");

  // A re-auth inside backloggd-mcp's request queue deadlocks it (the re-auth request
  // waits behind the one that triggered it). So: authenticate up front, time out any
  // call that hangs, and rebuild the client after a timeout since its queue is wedged.
  let ctx = null;
  async function connect() {
    const config = loadConfig();
    const http = new HttpClient(config);
    const session = new SessionManager(config, http);
    await session.ensureAuthenticated();
    return { api: new BackloggdApi(http, session), session, http, config };
  }
  async function backloggd(fn) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Backloggd timed out (BACKLOGGD_SESSION expired?)")), 120_000);
    });
    try {
      return await Promise.race([(async () => fn((ctx ??= await connect())))(), timeout]);
    } catch (e) {
      if (e.message.startsWith("Backloggd timed out")) ctx = null;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const tool = (name, args) => backloggd((c) => writeTools.find((t) => t.name === name).handler(args, c));

  // Only an exact title match counts: autocomplete's fuzzy hits would log the wrong game.
  // ponytail: several games sharing a title resolve to autocomplete's first (most popular) one.
  const resolved = new Map();
  async function resolve(name) {
    const key = normaliseTitle(name ?? "");
    if (!key) return null;
    if (!resolved.has(key)) {
      const hits = await backloggd((c) => c.api.autocomplete(name));
      const hit = hits.find((h) => normaliseTitle(h.title) === key);
      resolved.set(key, hit ? { id: hit.id, title: hit.title } : null);
    }
    return resolved.get(key);
  }

  async function currentGame() {
    for (const proc of runningProcesses()) {
      const game = await identify(proc, resolve);
      if (game) return game;
    }
    return null;
  }

  async function logSession(s) {
    try {
      await tool("log_play_session", s);
    } catch (e) {
      if (e.code !== "NOT_FOUND") throw e;
      await tool("log_game", { game: s.game, review_has_spoilers: false, is_replay: false, is_mastered: false });
      await tool("log_play_session", s);
    }
    console.log(`logged ${s.title}: ${s.hours}h${s.minutes}m on ${s.date}`);
    notify("Sessão salva no Backloggd", `${s.title} · ${s.hours}h${String(s.minutes).padStart(2, "0")}m`);
  }

  let state = null;
  try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}
  if (state && !state.id) state = null; // pre-autodetect state file

  for (;;) {
    try {
      const game = await currentGame();
      const next = tick(state, game, Date.now());
      if (next.ended) {
        const s = toSession(next.ended);
        // Print the full session on failure so it can be entered by hand.
        if (s) await logSession(s).catch((e) => {
          console.error("failed to log", JSON.stringify(s), e.message);
          notify("Falha ao salvar sessão", `${s.title} (${s.hours}h${s.minutes}m): ${e.message}`);
        });
      }
      if (next.state && next.state.id !== state?.id) {
        console.log(`playing ${next.state.title}`);
        await tool("set_game_status", { game: String(next.state.id), status: "playing" })
          .catch((e) => console.error(`shelf ${next.state.title}:`, e.message));
      }
      state = next.state;
      // Survive restarts mid-session.
      state ? writeFileSync(STATE, JSON.stringify(state)) : rmSync(STATE, { force: true });
    } catch (e) {
      console.error("poll:", e.message); // network blip: keep current session open
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (isSea() || process.argv[1] === fileURLToPath(import.meta.url)) main();
