# Security policy

## Reporting a vulnerability

Please do not open a public issue with the details of a vulnerability.

Email **abideenayinde7@gmail.com** with what you found, how to reproduce it, and
which version or commit you tested. You will get an acknowledgement, and a fix or
a clear answer afterwards. This is a small project maintained by one person, so
there is no fixed response time and no bug bounty.

If you cannot email, open an issue that says only that you have a security report
and how to reach you, with no technical detail, and it will be taken private.

## Scope

OfficePM is designed for a trusted network (an office LAN or a Tailscale tailnet),
not the public internet. Reports about exposing it directly to the internet, or
about the public demo password (`demo-password`, documented as demo-only), are
out of scope. In scope: authentication and sessions, access control between users,
file upload and download handling, the GitHub webhook endpoints, request parsing,
and the container image.

The README's "Security notes" section lists what the server does and the known
trade-offs, such as the in-memory login throttle.

## Supported versions

Only the current `main` branch (v2, once merged) receives fixes. The frozen v1 code
in `legacy/` is kept as a test oracle and is not maintained.
