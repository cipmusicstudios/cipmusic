import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import jwt from 'jsonwebtoken';

type Fixture = {
  root: Buffer;
  wrongRoot: Buffer;
  validJws: string;
  expiredLeafJws: string;
  wrongRootJws: string;
  wrongAlgorithmJws: string;
  tamperedPayloadJws: string;
  cleanup(): void;
};

function openssl(cwd: string, ...args: string[]): void {
  execFileSync('openssl', args, {cwd, stdio: 'ignore'});
}

function b64Der(cwd: string, pem: string, der: string): string {
  openssl(cwd, 'x509', '-in', pem, '-outform', 'DER', '-out', der);
  return readFileSync(join(cwd, der)).toString('base64');
}

export function createPkiFixture(): Fixture {
  const cwd = mkdtempSync(join(tmpdir(), 'cipmusic-apple-pki-'));
  const intermediateExt = join(cwd, 'intermediate.ext');
  const leafExt = join(cwd, 'leaf.ext');
  writeFileSync(intermediateExt, [
    'basicConstraints=critical,CA:TRUE,pathlen:0',
    'keyUsage=critical,keyCertSign,cRLSign',
    '1.2.840.113635.100.6.2.1=ASN1:NULL',
  ].join('\n'));
  writeFileSync(leafExt, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature',
    '1.2.840.113635.100.6.11.1=ASN1:NULL',
  ].join('\n'));

  openssl(cwd, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key');
  openssl(cwd, 'req', '-x509', '-new', '-key', 'root.key', '-sha256', '-days', '3650',
    '-subj', '/CN=CIP Music Apple Test Root', '-out', 'root.pem');
  openssl(cwd, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'intermediate.key');
  openssl(cwd, 'req', '-new', '-key', 'intermediate.key', '-subj', '/CN=CIP Music Apple Test Intermediate', '-out', 'intermediate.csr');
  openssl(cwd, 'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key',
    '-CAcreateserial', '-days', '3650', '-sha256', '-extfile', intermediateExt, '-out', 'intermediate.pem');
  openssl(cwd, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key');
  openssl(cwd, 'req', '-new', '-key', 'leaf.key', '-subj', '/CN=CIP Music Apple Test Leaf', '-out', 'leaf.csr');
  openssl(cwd, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key',
    '-CAcreateserial', '-days', '30', '-sha256', '-extfile', leafExt, '-out', 'leaf.pem');
  openssl(cwd, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'wrong-root.key');
  openssl(cwd, 'req', '-x509', '-new', '-key', 'wrong-root.key', '-sha256', '-days', '3650',
    '-subj', '/CN=CIP Music Wrong Test Root', '-out', 'wrong-root.pem');

  const leafDer = b64Der(cwd, 'leaf.pem', 'leaf.der');
  const intermediateDer = b64Der(cwd, 'intermediate.pem', 'intermediate.der');
  const rootDer = b64Der(cwd, 'root.pem', 'root.der');
  b64Der(cwd, 'wrong-root.pem', 'wrong-root.der');
  const x5c = [leafDer, intermediateDer, rootDer];
  const now = Date.now();
  const payload = {
    transactionId: 'pki-transaction', originalTransactionId: 'pki-original',
    bundleId: 'com.cipmusic.aurasounds', productId: 'com.cipmusic.aurasounds.premium.monthly.v2',
    subscriptionGroupIdentifier: '22099193', purchaseDate: now, originalPurchaseDate: now,
    expiresDate: now + 86_400_000, quantity: 1, type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED', signedDate: now, environment: 'Sandbox', transactionReason: 'PURCHASE',
  };
  const key = readFileSync(join(cwd, 'leaf.key'), 'utf8');
  const sign = (value: typeof payload) => jwt.sign(value, key, {algorithm: 'ES256', header: {alg: 'ES256', x5c}});
  const validJws = sign(payload);
  const expiredLeafJws = sign({...payload, signedDate: now + 45 * 86_400_000});
  const wrongRootJws = validJws;
  const parts = validJws.split('.');
  const wrongAlgorithmHeader = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'JWT', x5c})).toString('base64url');
  const wrongAlgorithmJws = [wrongAlgorithmHeader, parts[1], parts[2]].join('.');
  const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  decodedPayload.productId = 'tampered.product';
  const tamperedPayloadJws = [parts[0], Buffer.from(JSON.stringify(decodedPayload)).toString('base64url'), parts[2]].join('.');

  return {
    root: readFileSync(join(cwd, 'root.der')),
    wrongRoot: readFileSync(join(cwd, 'wrong-root.der')),
    validJws, expiredLeafJws, wrongRootJws, wrongAlgorithmJws, tamperedPayloadJws,
    cleanup: () => rmSync(cwd, {recursive: true, force: true}),
  };
}
