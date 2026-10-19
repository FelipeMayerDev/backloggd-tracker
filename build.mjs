// Builds build/backloggd-tracker.exe (Windows x64) from any OS with Node's single executable support.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const OUT = "build/backloggd-tracker.exe";
const NODE_EXE = `build/node-${process.version}-win-x64.exe`;
mkdirSync("build", { recursive: true });

// The executable can only require builtins, so everything goes into one CommonJS file.
// In a single executable __filename is the .exe, so import.meta.url points next to it.
await build({
  entryPoints: ["tracker.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "build/tracker.cjs",
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: "warning",
});

// The blob must match the node binary it is injected into, so use this exact version.
if (!existsSync(NODE_EXE)) {
  const base = `https://nodejs.org/dist/${process.version}`;
  const exe = Buffer.from(await (await fetch(`${base}/win-x64/node.exe`)).arrayBuffer());
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums.split("\n").find((l) => l.endsWith(" win-x64/node.exe"))?.split(/\s+/)[0];
  const got = createHash("sha256").update(exe).digest("hex");
  if (!want || want !== got) throw new Error(`node.exe checksum mismatch: ${got} != ${want}`);
  writeFileSync(NODE_EXE, exe);
}

writeFileSync("build/sea.json", JSON.stringify({
  main: "build/tracker.cjs",
  output: OUT,
  executable: NODE_EXE,
  disableExperimentalSEAWarning: true,
  useCodeCache: false, // code cache is platform-specific
  useSnapshot: false,
}));
execFileSync(process.execPath, ["--build-sea", "build/sea.json"], { stdio: "inherit" });

// Flip the PE subsystem from console (3) to GUI (2) so no console window opens.
const exe = readFileSync(OUT);
const subsystem = exe.readUInt32LE(0x3c) + 4 + 20 + 68;
if (exe.readUInt16LE(subsystem) !== 3) throw new Error("unexpected PE subsystem");
exe.writeUInt16LE(2, subsystem);
writeFileSync(OUT, exe);

// Release zip: the exe plus ready-to-edit config next to it.
const PKG = "build/backloggd-tracker";
mkdirSync(PKG, { recursive: true });
writeFileSync(`${PKG}/backloggd-tracker.exe`, exe);
writeFileSync(`${PKG}/.env`, "# Cole aqui o cookie _backloggd_session (veja LEIA-ME.txt)\r\nBACKLOGGD_SESSION=\r\n");
rmSync(`${PKG}/games.json`, { force: true });
writeFileSync(`${PKG}/LEIA-ME.txt`, readFileSync("LEIA-ME.txt", "utf8").replace(/\r?\n/g, "\r\n"));
rmSync("build/backloggd-tracker-windows.zip", { force: true });
// bsdtar writes zip; on Windows it ships as tar.exe.
execFileSync(process.platform === "win32" ? "tar" : "bsdtar",
  ["-a", "-cf", "backloggd-tracker-windows.zip", "backloggd-tracker"], { cwd: "build", stdio: "inherit" });
console.log("built build/backloggd-tracker-windows.zip");
