#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = path.join(root, 'scripts', 'deny-preview-network.cjs');
const probe = String.raw`
const cp=require('node:child_process'),dns=require('node:dns'),http=require('node:http'),https=require('node:https'),net=require('node:net'),tls=require('node:tls');
const tests={
  fetch:()=>fetch('https://example.invalid'), http:()=>http.get('http://example.invalid'), https:()=>https.get('https://example.invalid'),
  netConnect:()=>net.connect(1,'127.0.0.1'), netCreate:()=>net.createConnection(1,'127.0.0.1'), tls:()=>tls.connect(443,'example.invalid'),
  dnsLookup:()=>dns.lookup('example.invalid',()=>{}), dnsResolve:()=>dns.resolve('example.invalid',()=>{}), dnsPromise:()=>dns.promises.lookup('example.invalid'),
  exec:()=>cp.exec('curl --version'), execFile:()=>cp.execFile('wget',['--version']), spawn:()=>cp.spawn('nc',['-h']),
  execSync:()=>cp.execSync('curl --version'), execFileSync:()=>cp.execFileSync('wget',['--version']), spawnSync:()=>cp.spawnSync('nc',['-h']), fork:()=>cp.fork('missing.js'),
};
const result={};for(const [name,fn] of Object.entries(tests)){try{fn();result[name]=false}catch(e){result[name]=/Preview build attempted network access/.test(e.message)}}process.stdout.write(JSON.stringify(result));
`;
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require=${JSON.stringify(preload)}` };
const run = spawnSync(process.execPath, ['-e', probe], { cwd: root, env, encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr);
const result = JSON.parse(run.stdout);
assert.ok(Object.values(result).every(Boolean), `network hook canary failed: ${JSON.stringify(result)}`);
console.log(`[preview-network] ${Object.keys(result).length} network exit canaries blocked`);
