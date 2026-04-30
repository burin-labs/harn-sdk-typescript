#!/usr/bin/env node
import { readFileSync } from "node:fs";

const validateTag = process.argv.includes("--validate-tag");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = pkg.version;
const tagName = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

if (!isSemver(version)) {
  throw new Error(`package.json version is not valid semver: ${version}`);
}

if (validateTag && tagName !== `v${version}`) {
  throw new Error(`Release tag ${tagName ?? "(missing)"} does not match package.json version v${version}.`);
}

const distTag = npmDistTag(version);
const output = process.env.GITHUB_OUTPUT;

if (output) {
  const fs = await import("node:fs");
  fs.appendFileSync(output, `package-name=${pkg.name}\n`);
  fs.appendFileSync(output, `version=${version}\n`);
  fs.appendFileSync(output, `dist-tag=${distTag}\n`);
}

console.log(`${pkg.name}@${version} -> npm dist-tag ${distTag}`);

function npmDistTag(value) {
  const prerelease = value.match(/^[0-9]+\.[0-9]+\.[0-9]+-([0-9A-Za-z-]+)/)?.[1];
  if (!prerelease) {
    return "latest";
  }

  const preid = prerelease.split(".")[0];
  if (!/^[a-z][a-z0-9._-]*$/i.test(preid)) {
    throw new Error(`Cannot derive a safe npm dist-tag from prerelease identifier: ${preid}`);
  }
  return preid;
}

function isSemver(value) {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(value);
}
