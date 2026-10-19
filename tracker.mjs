// Watches running processes (Windows or Linux) for the games in games.json and logs each session to Backloggd.
// Env: backloggd-mcp auth (BACKLOGGD_SESSION | BACKLOGGD_USERNAME/PASSWORD | BACKLOGGD_BROWSER_IMPORT=firefox).
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { loadConfig } from "backloggd-mcp/dist/config.js";
import { HttpClient } from "backloggd-mcp/dist/http/client.js";
import { SessionManager } from "backloggd-mcp/dist/auth/session.js";
import { BackloggdApi } from "backloggd-mcp/dist/api/index.js";
import { writeTools } from "backloggd-mcp/dist/tools/write.js";

const POLL_MS = 60_000;
const MIN_MINUTES = Number(process.env.MIN_MINUTES ?? 5); // ignore launcher blips
const STATE = new URL("./state.json", import.meta.url);

const day = (t) => new Date(t).toLocaleDateString("sv"); // YYYY-MM-DD, local time

// Pure transition: returns the next state and the finished session, if any.
export function tick(state, game, now) {
  if (state?.game === game) return { state: state && { ...state, last: now } };
  // End at the last poll that saw it, so downtime or restarts don't inflate the session.
  const ended = state && { ...state, end: state.last };
  return { state: game ? { game, start: now, last: now } : null, ended };
}

export function toSession({ game, start, end }) {
  const mins = Math.round((end - start) / 60_000);
  if (mins < MIN_MINUTES) return null;
  const s = { game, date: day(start), hours: Math.floor(mins / 60), minutes: mins % 60 };
  if (day(end) !== s.date) s.end_date = day(end);
  return s;
}

// games.json maps an exe name to its Backloggd title.
let GAMES = {};
try { GAMES = JSON.parse(readFileSync(new URL("./games.json", import.meta.url), "utf8")); } catch {}

// Lowercased exe names of running processes.
export function runningExes() {
  if (process.platform === "win32") {
    const out = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" });
    return new Set(out.split(/\r?\n/).map((l) => l.slice(1, l.indexOf('"', 1)).toLowerCase()));
  }
  // Native and Wine/Proton games carry their exe path in the command line.
  // ponytail: splits on whitespace, so an exe *name* with spaces won't match.
  const out = execFileSync("ps", ["-eo", "args="], { encoding: "utf8" });
  return new Set(out.split(/\s+/).map((t) => t.split(/[\\/]/).pop().toLowerCase()));
}

function currentGame() {
  const running = runningExes();
  return Object.entries(GAMES).find(([exe]) => running.has(exe.toLowerCase()))?.[1] ?? null;
}

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

async function main() {
  if (!Object.keys(GAMES).length) console.error("games.json is missing or empty: no games to watch");

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
  async function tool(name, args) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Backloggd timed out (BACKLOGGD_SESSION expired?)")), 120_000);
    });
    try {
      const run = (async () => {
        ctx ??= await connect();
        return writeTools.find((t) => t.name === name).handler(args, ctx);
      })();
      return await Promise.race([run, timeout]);
    } catch (e) {
      if (e.message.startsWith("Backloggd timed out")) ctx = null;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function logSession(s) {
    try {
      await tool("log_play_session", s);
    } catch (e) {
      if (e.code !== "NOT_FOUND") throw e;
      await tool("log_game", { game: s.game, review_has_spoilers: false, is_replay: false, is_mastered: false });
      await tool("log_play_session", s);
    }
    console.log(`logged ${s.game}: ${s.hours}h${s.minutes}m on ${s.date}`);
    notify("Sessão salva no Backloggd", `${s.game} · ${s.hours}h${String(s.minutes).padStart(2, "0")}m`);
  }

  let state = null;
  try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}

  for (;;) {
    try {
      const game = currentGame();
      const next = tick(state, game, Date.now());
      if (next.ended) {
        const s = toSession(next.ended);
        // Print the full session on failure so it can be entered by hand.
        if (s) await logSession(s).catch((e) => {
          console.error("failed to log", JSON.stringify(s), e.message);
          notify("Falha ao salvar sessão", `${s.game} (${s.hours}h${s.minutes}m): ${e.message}`);
        });
      }
      if (next.state && next.state.game !== state?.game) {
        console.log(`playing ${next.state.game}`);
        await tool("set_game_status", { game: next.state.game, status: "playing" })
          .catch((e) => console.error(`shelf ${next.state.game}:`, e.message));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
