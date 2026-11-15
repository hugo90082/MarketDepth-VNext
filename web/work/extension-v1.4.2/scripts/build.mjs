import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const files = [
  "background.js",
  "coinglass-frame.js",
  "coinglass-page.js",
  "depthwatch-content.js",
  "offscreen.html",
  "offscreen.js",
  "icon.svg",
];
for (const file of files) await cp(resolve(root, "src", file), resolve(dist, file));
await cp(resolve(root, "src", "lib"), resolve(dist, "lib"), { recursive: true });
await cp(resolve(root, "src", "ui"), resolve(dist, "ui"), { recursive: true });

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built CoinGlass 指標提醒 ${manifest.version} -> ${dist}`);
