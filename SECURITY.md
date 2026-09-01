# Security policy

Report suspected vulnerabilities privately to the repository owner rather than
opening a public issue. Include affected routes or file types, reproduction
steps, and impact without attaching confidential documents.

Never commit populated environment files, access tokens, payment credentials,
database URLs, or document contents from real users. Uploaded conversion files
must remain inside per-request temporary directories and be deleted after the
response is produced.

Supported releases receive fixes on `main`. Dependency risk is checked in CI;
the isolated production API graph must stay free of high and critical findings,
and the Expo build graph may contain only the explicitly reviewed Metro
`image-size` advisories documented in [DEPENDENCIES.md](DEPENDENCIES.md). CodeQL
also analyzes the TypeScript and Python source on every push and pull request,
with an additional scheduled scan each week.

Heavy conversion routes enforce upload, per-client request, global concurrency,
subprocess-output, and timeout limits before processing untrusted documents.
Public deployments should retain those application controls and add equivalent
limits at their trusted ingress proxy. Forwarding headers must remain disabled
unless that proxy overwrites them.
