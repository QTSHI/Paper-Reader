import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const contentDir = path.join(buildDir, "content");
const distDir = path.join(root, "dist");

await rm(buildDir, { recursive: true, force: true });
await rm(distDir, { recursive: true, force: true });
await mkdir(contentDir, { recursive: true });
await mkdir(distDir, { recursive: true });
await cp(path.join(root, "addon"), buildDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "main.ts")],
  outfile: path.join(contentDir, "main.js"),
  bundle: true,
  format: "iife",
  globalName: "PaperReader",
  target: "firefox140",
  sourcemap: true,
  external: ["fs", "path", "url", "canvas"],
});

await build({
  entryPoints: [path.join(root, "src", "ui", "reader.ts")],
  outfile: path.join(contentDir, "reader.js"),
  bundle: true,
  format: "iife",
  target: "firefox140",
  sourcemap: true,
});

await cp(path.join(root, "src", "ui", "reader.xhtml"), path.join(contentDir, "reader.xhtml"));
await cp(path.join(root, "src", "ui", "reader.css"), path.join(contentDir, "reader.css"));
await cp(
  path.join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  path.join(contentDir, "pdf.worker.mjs"),
);

const manifest = JSON.parse(await readFile(path.join(buildDir, "manifest.json"), "utf8"));
const xpiPath = path.join(distDir, `paper-reading-assistant-${manifest.version}.xpi`);
await execFileAsync("zip", ["-q", "-r", xpiPath, "."], { cwd: buildDir });

await writeFile(
  path.join(distDir, "build-info.json"),
  JSON.stringify({ name: manifest.name, version: manifest.version, xpi: path.basename(xpiPath) }, null, 2),
);

process.stdout.write(`${xpiPath}\n`);
