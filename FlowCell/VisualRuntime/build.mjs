import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcRoot = path.join(__dirname, "src");
const outputRoot = path.join(__dirname, "..", "runtime", "visual-runtime");

await mkdir(outputRoot, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(srcRoot, "runtime.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome109"],
  outfile: path.join(outputRoot, "visual-runtime.bundle.js"),
  sourcemap: false,
  legalComments: "none",
  loader: {
    ".svg": "text"
  }
});

await copyFile(path.join(srcRoot, "host.html"), path.join(outputRoot, "host.html"));
