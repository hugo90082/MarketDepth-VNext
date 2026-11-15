import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicManifest } from "../src/lib/public-manifest.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const stage = resolve(root, ".release-staging");

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(dist, stage, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const publicManifest = createPublicManifest(manifest);
await writeFile(resolve(stage, "manifest.json"), `${JSON.stringify(publicManifest, null, 2)}\n`);

console.log(`Prepared public extension ${publicManifest.version} -> ${stage}`);
