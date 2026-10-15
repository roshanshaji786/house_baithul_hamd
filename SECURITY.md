# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's [private vulnerability reporting](https://github.com/roshanshaji786/house_baithul_hamd/security/advisories/new) (Security tab › *Report a vulnerability*), or contact the maintainer through their GitHub profile. We aim to reply within a week.

## How the app protects you

- **Photos stay in the browser** (IndexedDB) unless you self-host the app with an AI engine and choose it.
- **API keys stay on the server.** They are read from `.env` (which git ignores) and never sent to the browser. `GET /api/config` only reports which engines are available.
- **The server listens on localhost by default.** Setting `HOST=0.0.0.0` exposes it to your network, and anyone who can reach it can use your API keys. Don't expose it to the internet without adding authentication.
- **Paid endpoints are rate-limited** (in memory, per IP). Uploaded images are validated (JPEG/PNG/WebP, 12 MB or less), and video jobs are limited in number, duration and size.

## Tips for self-hosting

- Never commit `.env` or paste API keys into issues.
- Set spending limits on your OpenAI, Google and Anthropic accounts.
- Keep dependencies up to date (`npm audit`, `npm update`).
