# Security Policy

## Supported Versions

zap.cooking is a continuously deployed web application. Security updates are applied to the current production release. Only the latest version is actively supported.

| Version      | Supported          |
| ------------ | ------------------ |
| Latest (main)| :white_check_mark: |
| Older builds | :x:                |

## Reporting a Vulnerability

We take security seriously at zap.cooking. If you discover a vulnerability, please follow responsible disclosure practices and **do not** open a public GitHub issue.

### How to Report

Report vulnerabilities by sending a Nostr DM to the zap.cooking maintainer or by emailing **security@zap.cooking**.

Please include:
- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact and affected components
- Any suggested mitigations if known

### What to Expect

- **Acknowledgment**: You will receive an acknowledgment within 48 hours of your report.
- **Updates**: We will provide status updates every 5–7 days while the issue is under investigation.
- **Resolution timeline**: We aim to patch critical vulnerabilities within 7 days and moderate issues within 30 days.
- **Disclosure**: We ask that you allow us reasonable time to address the issue before any public disclosure.

### Accepted Vulnerabilities

If your report is accepted, we will:
- Work with you on a fix and coordinated disclosure timeline
- Credit you in the release notes or changelog (if you wish)
- Potentially reward impactful discoveries with a zap ⚡

### Declined Vulnerabilities

If your report is declined, we will provide a clear explanation of why the issue does not qualify as a security vulnerability (e.g., known limitation, out of scope, intended behavior).

## Scope

The following are in scope for security reports:

- **zap.cooking** web application and PWA
- **Android and iOS** mobile apps
- **members.zap.cooking** private relay
- Lightning Network payment flows and Zap integrations
- NIP-46 remote signing implementations
- Authentication and session management
- User data handling and privacy

Out of scope:
- Third-party Nostr relays not operated by zap.cooking
- Social engineering attacks
- Denial of service via Nostr spam (this is a protocol-level concern)
- Issues in underlying libraries without a demonstrated exploit path

## Security Considerations for Nostr & Lightning

zap.cooking is built on decentralized protocols. Users should be aware that:

- **Private keys are your responsibility.** zap.cooking does not store or have access to your Nostr private key when using a signer extension or NIP-46.
- **Lightning payments are irreversible.** Always verify zap amounts before confirming.
- **Nostr is a public protocol.** Content published to public relays is permanently public.

We recommend users always interact with zap.cooking using a hardware signer or trusted NIP-46 remote signer rather than entering private keys directly.
