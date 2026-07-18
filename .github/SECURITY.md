# Security Policy

## Supported versions

Only the latest release published on npm (`@surgee/pi-flow`) receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately via [GitHub Security Advisories](https://github.com/Suge8/pi-flow/security/advisories/new). Include the affected version, reproduction steps, and impact. You will get a response within 7 days, and a fix or mitigation plan within 30 days for confirmed issues.

## Scope notes

Pi Flow runs local subprocesses (background Pi workers and read-only check models) and a local-only HTML report server bound to `127.0.0.1`. Reports of remote exposure, privilege escalation through spawned processes, or prompt-injection paths that break the read-only guarantee of reviewers are especially valuable.
