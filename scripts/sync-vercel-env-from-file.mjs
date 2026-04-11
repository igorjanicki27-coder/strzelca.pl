#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const args = process.argv.slice(2);

function printUsage() {
  console.log(`Uzycie:
  node scripts/sync-vercel-env-from-file.mjs [--file .env.local] [--env production] KEY [KEY...]
  node scripts/sync-vercel-env-from-file.mjs [--file .env.local] [--env production] --all

Przyklady:
  node scripts/sync-vercel-env-from-file.mjs STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
  node scripts/sync-vercel-env-from-file.mjs --file .env.local --env preview --all`);
}

function stripOuterQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const map = new Map();
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = rawLine.indexOf('=');
    if (eqIndex === -1) continue;

    const rawKey = rawLine.slice(0, eqIndex).trim();
    if (!rawKey || rawKey.startsWith('#')) continue;

    let rawValue = rawLine.slice(eqIndex + 1);
    if (rawValue.startsWith(' ')) rawValue = rawValue.trimStart();
    const value = stripOuterQuotes(rawValue);
    map.set(rawKey, value);
  }

  return map;
}

function runVercel(argsList, options = {}) {
  const result = spawnSync(
    'npx',
    ['--yes', 'vercel@latest', ...argsList],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: options.input || '',
      env: process.env,
    },
  );

  return result;
}

let envFile = '.env.local';
let targetEnv = 'production';
let syncAll = false;
const requestedKeys = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--file') {
    envFile = args[i + 1] || envFile;
    i += 1;
    continue;
  }
  if (arg === '--env') {
    targetEnv = args[i + 1] || targetEnv;
    i += 1;
    continue;
  }
  if (arg === '--all') {
    syncAll = true;
    continue;
  }
  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }
  requestedKeys.push(arg);
}

if (!syncAll && requestedKeys.length === 0) {
  console.error('Podaj przynajmniej jeden klucz albo uzyj --all.');
  printUsage();
  process.exit(1);
}

const envPath = path.resolve(cwd, envFile);
if (!fs.existsSync(envPath)) {
  console.error(`Nie znaleziono pliku env: ${envPath}`);
  process.exit(1);
}

const envMap = parseEnvFile(envPath);
const keysToSync = syncAll ? Array.from(envMap.keys()) : requestedKeys;

if (!keysToSync.length) {
  console.error('Brak kluczy do synchronizacji.');
  process.exit(1);
}

const missingKeys = keysToSync.filter((key) => !envMap.has(key));
if (missingKeys.length) {
  console.error(`Brak kluczy w ${envFile}: ${missingKeys.join(', ')}`);
  process.exit(1);
}

console.log(`Plik: ${envPath}`);
console.log(`Srodowisko Vercel: ${targetEnv}`);
console.log(`Klucze do synchronizacji: ${keysToSync.join(', ')}`);

for (const key of keysToSync) {
  const value = envMap.get(key) || '';
  console.log(`\nSynchronizuje ${key}...`);

  const removeResult = runVercel(['env', 'rm', key, targetEnv, '--yes']);
  if (removeResult.status !== 0) {
    const output = `${removeResult.stdout || ''}${removeResult.stderr || ''}`;
    if (!/does not exist|not found|could not find/i.test(output)) {
      console.error(output.trim() || `Nie udalo sie usunac starej wartosci ${key}.`);
      process.exit(removeResult.status || 1);
    }
  }

  const addResult = runVercel(['env', 'add', key, targetEnv], { input: value });
  if (addResult.status !== 0) {
    console.error((addResult.stdout || '') + (addResult.stderr || ''));
    process.exit(addResult.status || 1);
  }
}

console.log('\nSynchronizacja zakonczona pomyslnie.');
