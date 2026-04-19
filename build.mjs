import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const watch = process.argv.includes("--watch");

const outdir = path.join(process.cwd(), "dist");

async function copyStatic() {
  fs.mkdirSync(outdir, { recursive: true });
  for (const f of ["manifest.json", "src/popup.html", "src/options.html"]) {
    const dest = f.endsWith("manifest.json")
      ? path.join(outdir, "manifest.json")
      : path.join(outdir, path.basename(f));
    fs.copyFileSync(path.join(process.cwd(), f), dest);
  }
  const iconsDir = path.join(process.cwd(), "icons");
  if (fs.existsSync(iconsDir)) {
    const destIcons = path.join(outdir, "icons");
    fs.mkdirSync(destIcons, { recursive: true });
    for (const n of fs.readdirSync(iconsDir)) {
      fs.copyFileSync(path.join(iconsDir, n), path.join(destIcons, n));
    }
  }
}

const ctx = await esbuild.context({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup.ts",
    options: "src/options.ts",
  },
  bundle: true,
  outdir,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: false,
});

await copyStatic();

if (watch) {
  await ctx.watch();
  console.log("watching…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("built to dist/");
}
