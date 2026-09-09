# Security Policy

## Supported Versions

Security fixes are applied to the latest released version on the default branch of [HuolalaTech/hadice](https://github.com/HuolalaTech/hadice). Older releases may not receive backports.

## Reporting a Vulnerability

Please **do not** open a public GitHub Issue for security vulnerabilities.

Report privately via one of:

1. GitHub Security Advisories: **Security → Report a vulnerability** on the repository (preferred when enabled)
2. Email the maintainer contact listed in the in-app Help dialog (`haivo@foxmail.com`) with subject `[Hadice Security]`

Include:

- Affected version / commit
- Reproduction steps or proof-of-concept (private)
- Impact assessment if known

We aim to acknowledge reports within **7 business days**. Please allow reasonable time for investigation and coordinated disclosure before public discussion.

## Scope Notes

Hadice ships third-party debug tools (adb, hdc, scrcpy, etc.). Vulnerabilities that belong entirely to upstream projects should be reported upstream; we appreciate a heads-up if a bundled binary version is affected so we can upgrade.
