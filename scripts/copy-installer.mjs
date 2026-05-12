import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const tauriConf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = tauriConf.version;
const productName = tauriConf.productName;

// ─── Step 1: patch installer.nsi ─────────────────────────────────────────────

const nsisScript = join(root, "src-tauri", "target", "release", "nsis", "x64", "installer.nsi");
const licenseRtf = resolve(root, "src-tauri", "assets", "license.rtf");
const hooksPath = resolve(root, "src-tauri", "assets", "installer-hooks.nsh").replace(/\//g, "\\");

if (existsSync(nsisScript) && existsSync(licenseRtf)) {
  let nsi = readFileSync(nsisScript, "utf8");
  let changed = false;

  // Remove stale installer-hooks !include if present (from a previous attempt)
  const hooksInclude = `!include "${hooksPath}"`;
  if (nsi.includes(hooksInclude)) {
    nsi = nsi.replace(hooksInclude + "\n", "").replace(hooksInclude, "");
    changed = true;
    console.log("✓ Removed stale installer-hooks.nsh include");
  }

  // Inject the license path (handles both unset "" and already-set cases)
  const licenseEmpty = `!define LICENSE ""`;
  const licensePatched = `!define LICENSE "${licenseRtf.replace(/\//g, "\\")}"`;

  if (nsi.includes(licenseEmpty)) {
    nsi = nsi.replace(licenseEmpty, licensePatched);
    changed = true;
    console.log("✓ Injected license path into installer.nsi");
  } else if (!nsi.includes(licensePatched)) {
    console.warn("  LICENSE line not found in expected form — skipping patch");
  } else {
    console.log("  installer.nsi already has license path");
  }

  if (changed) {
    writeFileSync(nsisScript, nsi, "utf8");
  }

  // ─── Step 2: recompile NSIS installer ──────────────────────────────────────

  const makensis = "C:\\Users\\Bittu\\AppData\\Local\\tauri\\NSIS\\makensis.exe";
  if (existsSync(makensis)) {
    console.log("  Recompiling NSIS installer with license page...");
    execSync(`"${makensis}" "${nsisScript}"`, {
      cwd: join(root, "src-tauri", "target", "release", "nsis", "x64"),
      stdio: "inherit",
    });

    const compiled = join(root, "src-tauri", "target", "release", "nsis", "x64", "nsis-output.exe");
    const bundleDest = join(root, "src-tauri", "target", "release", "bundle", "nsis",
      `${productName}_${version}_x64-setup.exe`);

    if (existsSync(compiled)) {
      copyFileSync(compiled, bundleDest);
      console.log("✓ Replaced bundle installer with license-patched version");
    }
  } else {
    console.warn(`  makensis not found — skipping NSIS recompile`);
  }
}

// ─── Step 3: copy installer(s) to project root ───────────────────────────────

const bundleDir = join(root, "src-tauri", "target", "release", "bundle");

const candidates = [
  join(bundleDir, "nsis", `${productName}_${version}_x64-setup.exe`),
  join(bundleDir, "msi",  `${productName}_${version}_x64_en-US.msi`),
];

let copied = 0;
for (const src of candidates) {
  if (existsSync(src)) {
    const filename = src.split(/[/\\]/).pop();
    const dest = join(root, filename);
    copyFileSync(src, dest);
    console.log(`✓ Copied ${filename} → project root`);
    copied++;
  }
}

if (copied === 0) {
  console.error("No installer found. Run `npm run tauri build` first.");
  process.exit(1);
}
