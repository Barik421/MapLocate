import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "sidepanel.html",
  "sidepanel.js",
  "sidepanel.css",
  "options.html",
  "options.js",
  "options.css",
  "theme.css",
  "_locales/en/messages.json",
  "_locales/uk/messages.json",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `Missing required file: ${file}`);
}

const manifest = readJson("manifest.json");
assert(manifest.manifest_version === 3, "Manifest must use MV3");
assert(manifest.name === "__MSG_extensionName__", "Manifest name should be localized");
assert(manifest.description === "__MSG_extensionDescription__", "Manifest description should be localized");
assert(manifest.default_locale === "en", "Default locale should be English");

const en = readJson("_locales/en/messages.json");
const uk = readJson("_locales/uk/messages.json");
const enKeys = Object.keys(en).sort();
const ukKeys = Object.keys(uk).sort();
const missingInUk = enKeys.filter((key) => !ukKeys.includes(key));
const missingInEn = ukKeys.filter((key) => !enKeys.includes(key));
assert(!missingInUk.length, `Missing Ukrainian locale keys: ${missingInUk.join(", ")}`);
assert(!missingInEn.length, `Missing English locale keys: ${missingInEn.join(", ")}`);

const sourceFiles = [
  "background.js",
  "content.js",
  "sidepanel.js",
  "options.js",
  "shared.js",
  "sidepanel.html",
  "options.html"
];

for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert(!/<script[^>]+https?:\/\//i.test(source), `Remote script tag found in ${file}`);
  assert(!/\beval\s*\(/.test(source), `eval() found in ${file}`);
  assert(!/\bnew Function\s*\(/.test(source), `new Function() found in ${file}`);
}

console.log("MapLocate release validation passed.");

