# Security

This is a desktop app: each install keeps its own data on that computer. Nothing is sent to a cloud service.

- **Report a problem:** open a private security advisory on this repository (Security tab), or contact the maintainer directly. Please do not post details in a public issue.
- **What the app does:** it listens on the computer's loopback address only, refuses requests addressed to any other host, requires a login for all data, limits wrong passwords, stores passwords with bcrypt (cost 12), checks uploaded files against their claimed type, and sends strict browser security headers.
- **Keep it safe in practice:** turn on Windows disk encryption (BitLocker), give each person their own Windows login, keep regular backups of the app's data folder, and protect the GitHub account that publishes updates with two-factor authentication.
- **Never commit** passwords, tokens, database files or client documents. The `.gitignore` blocks the common ones.