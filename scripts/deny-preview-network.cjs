const childProcess = require('node:child_process');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const deny = () => { throw new Error('Preview build attempted network access'); };
for (const target of [[http, ['request', 'get']], [https, ['request', 'get']], [net, ['connect', 'createConnection']], [tls, ['connect']]]) {
  for (const method of target[1]) target[0][method] = deny;
}
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
  if (typeof dns[method] === 'function') dns[method] = deny;
  if (typeof dns.promises?.[method] === 'function') dns.promises[method] = deny;
}
globalThis.fetch = deny;

const NETWORK_TOOLS = new Set(['curl', 'wget', 'nc', 'ncat', 'socat', 'ftp']);
const isNetworkTool = command => NETWORK_TOOLS.has(path.basename(String(command).trim().split(/\s+/)[0]).toLowerCase());
for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const original = childProcess[method];
  childProcess[method] = function guardedChild(command, ...args) {
    if (isNetworkTool(command)) return deny();
    return original.call(this, command, ...args);
  };
}
childProcess.fork = deny;
