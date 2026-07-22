# Apple Root CA deployment assets

Before deployment, place the reviewed DER/PEM Apple root certificates from Apple PKI in this directory.
They are bundled by Netlify through `included_files`; the Function never downloads certificates at runtime.

Required files from <https://www.apple.com/certificateauthority/>:

- `AppleIncRootCertificate.cer`
- `AppleRootCA-G2.cer`
- `AppleRootCA-G3.cer`

`checksums.review-required.sha256` is a review draft recorded on 2026-07-21.
Do not add the certificate files until a second person independently downloads
them from Apple, verifies the SHA-256 values and X.509 metadata, and approves the
manifest. Test certificates belong only under `tests/apple/fixtures/pki` and
must never be copied into this directory.

No production private key, JWS, receipt, transaction payload, or API JWT belongs here.
Phase 1A intentionally contains no certificate bytes and therefore fails closed with
`APPLE_ROOT_CA_MISSING` until the assets are separately reviewed and supplied.
