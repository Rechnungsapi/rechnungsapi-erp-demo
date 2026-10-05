# Security policy

## Reporting a vulnerability

Please report security problems privately by email to **support@rechnungsapi.de** with the subject "Security". Don't open a public issue, and don't include real invoices or API tokens in your report. We will acknowledge your report and keep you informed while we look into it.

## Supported versions

Only the latest commit on `main` receives security fixes.

## What this demo is, and is not

This is a demo that is meant to be read and copied. It is not a hardened product:

- **It has no login.** It listens on `127.0.0.1` by default. Don't expose it to the internet or to a network you don't trust: anyone who can reach it can create invoices with your RechnungsAPI token and read your invoices.
- **Your token stays on the server.** It is read from the environment (`.env` is ignored by git) and used only for calls to RechnungsAPI. It is never sent to the browser, stored in the data folder or written to a log. If it has been exposed, create a new one in your RechnungsAPI profile.
- **The data is stored unencrypted** as plain JSON and files in the `data` folder, so protect that folder like any other place where invoices live.

The demo defends itself against the usual local-tool attacks: it answers only to localhost host names (`ALLOWED_HOSTS` adds more), refuses state-changing requests that come from other websites, sends a strict content security policy, loads nothing from the internet and recognises uploads by their content. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security).

If you build on this code for a real product, add authentication, HTTPS, a database and proper secrets management first. [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md#6-before-you-go-to-production) has a checklist.
