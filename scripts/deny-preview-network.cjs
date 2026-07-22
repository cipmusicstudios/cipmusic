const http = require('node:http');
const https = require('node:https');

const deny = () => {
  throw new Error('Preview build attempted network access');
};

http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
globalThis.fetch = deny;
