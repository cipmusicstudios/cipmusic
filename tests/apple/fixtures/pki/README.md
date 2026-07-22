# Test PKI boundary

The cryptographic tests generate an ephemeral EC P-256 root, intermediate,
leaf, and ES256 JWS under the operating-system temporary directory. The test
certificates contain the Apple leaf and intermediate extension OIDs required by
Apple's official verifier. Test private keys and generated certificates are
deleted after each successful test and are never stored in the production root
certificate directory.

Negative fixtures cover an untrusted root, a leaf that is expired at the JWS
effective date, a non-ES256 header, and a payload changed after signing. These
tests validate the official library's certificate-chain and signature path with
an injected test trust anchor; they do not claim to validate Apple's production
certificate chain.
