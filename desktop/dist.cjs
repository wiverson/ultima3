// Builds installers with electron-builder at the build's version (see version.cjs), which is passed as metadata so
// package.json is never edited. Arguments go through: node dist.cjs --linux
const { execFileSync } = require("node:child_process");
const { buildVersion } = require("./version.cjs");
const version = buildVersion();
console.log(`building version ${version}`);
execFileSync(
  "npx",
  [
    "electron-builder",
    ...process.argv.slice(2),
    "--publish",
    "never",
    `--config.extraMetadata.version=${version}`,
  ],
  { stdio: "inherit", cwd: __dirname },
);
