# FileMint privacy notes

Last updated: 2026-09-01

FileMint is an open-source document application. Many operations run locally
on the user's device. Features that use the optional conversion server send the
selected document to that server for the requested operation; request-scoped
temporary files are deleted after the response is produced.

When accounts are enabled, the configured FileMint server stores the email,
username, profile fields, a password hash, sessions, purchase references, and
daily usage counters. It does not store plaintext passwords. Users can delete
their account from Settings. A deployment operator may retain encrypted
backups or security logs under its own published retention policy.

Optional integrations send only the data needed to provide their feature:
Stripe processes payments, Resend delivers account email, Sentry receives
configured error telemetry, and Collabora renders office documents. These
services are inactive unless a deployment operator configures them.

The FileMint source project does not sell personal data. Operators who deploy a
public FileMint service are responsible for publishing contact details,
retention periods, hosting locations, and any additional disclosures required
for their users and jurisdiction.

Report security concerns using the private process in [SECURITY.md](SECURITY.md).
For other project questions, use the repository's GitHub issue tracker without
attaching confidential documents.
