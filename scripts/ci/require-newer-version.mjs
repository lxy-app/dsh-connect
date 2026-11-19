#!/usr/bin/env node

const [candidate, current] = process.argv.slice(2);
if (!candidate) {
  throw new Error('Usage: require-newer-version.mjs <candidate> [current]');
}

function parse(version) {
  const numeric = '(0|[1-9]\\d*)';
  const identifier = '[0-9A-Za-z-]+';
  const pattern = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-(${identifier}(?:\\.${identifier})*))?$`);
  const match = pattern.exec(version);
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  const prerelease = match[4]?.split('.') ?? [];
  for (const part of prerelease) {
    if (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0')) {
      throw new Error(`Numeric prerelease identifiers cannot contain leading zeroes: ${version}`);
    }
  }
  return {
    core: match.slice(1, 4).map(BigInt),
    prerelease,
  };
}

function compareNumeric(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumeric(BigInt(left), BigInt(right));
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = compareNumeric(left.core[index], right.core[index]);
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const sharedLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const difference = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

const parsedCandidate = parse(candidate);
if (!current) {
  console.log(`No current channel version was found; ${candidate} can be published.`);
  process.exit(0);
}

const comparison = compare(parsedCandidate, parse(current));
if (comparison <= 0) {
  throw new Error(`Candidate ${candidate} must be newer than the current channel version ${current}.`);
}
console.log(`Channel version increases from ${current} to ${candidate}.`);
