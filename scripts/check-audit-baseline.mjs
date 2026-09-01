import { spawnSync } from 'node:child_process';

const baseline = {
  high: 4,
  critical: 0,
};
const allowedHighPackages = new Set(['image-size', 'metro', 'metro-config', 'metro-transform-worker']);
const allowedHighAdvisories = new Set([
  'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
]);

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = npmCli ? [npmCli, 'audit', '--omit=dev', '--json'] : ['audit', '--omit=dev', '--json'];
const result = spawnSync(command, args, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: !npmCli && process.platform === 'win32',
});

if (result.error) {
  console.error(`Unable to run npm audit: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  console.error(result.stderr || result.stdout || 'npm audit did not return valid JSON.');
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
const vulnerabilities = report.vulnerabilities;
if (!report.metadata?.vulnerabilities || !vulnerabilities) {
  console.error(report.error?.summary || 'npm audit returned an incomplete report.');
  process.exit(1);
}
const high = Number(counts.high ?? 0);
const critical = Number(counts.critical ?? 0);
const highPackages = Object.entries(vulnerabilities)
  .filter(([, vulnerability]) => vulnerability?.severity === 'high')
  .map(([name]) => name);
const highAdvisories = new Set(
  Object.values(vulnerabilities).flatMap((vulnerability) =>
    Array.isArray(vulnerability?.via)
      ? vulnerability.via
          .filter((via) => typeof via === 'object' && via?.severity === 'high')
          .map((via) => via.url)
          .filter(Boolean)
      : [],
  ),
);
const unexpectedPackages = highPackages.filter((name) => !allowedHighPackages.has(name));
const unexpectedAdvisories = [...highAdvisories].filter((url) => !allowedHighAdvisories.has(url));

console.log(`production audit: high=${high}/${baseline.high}, critical=${critical}/${baseline.critical}`);

if (
  high > baseline.high ||
  critical > baseline.critical ||
  unexpectedPackages.length > 0 ||
  unexpectedAdvisories.length > 0
) {
  console.error(
    `The production dependency risk changed outside the reviewed baseline. ` +
      `Unexpected packages: ${unexpectedPackages.join(', ') || 'none'}; ` +
      `unexpected advisories: ${unexpectedAdvisories.join(', ') || 'none'}.`,
  );
  process.exit(1);
}

console.log('Dependency audit baseline passed; only the reviewed Expo/Metro image-size advisories remain.');
