import { spawnSync } from 'node:child_process';

const baseline = {
  high: 4,
  critical: 0,
};

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
if (!report.metadata?.vulnerabilities) {
  console.error(report.error?.summary || 'npm audit returned an incomplete report.');
  process.exit(1);
}
const high = Number(counts.high ?? 0);
const critical = Number(counts.critical ?? 0);

console.log(`production audit: high=${high}/${baseline.high}, critical=${critical}/${baseline.critical}`);

if (high > baseline.high || critical > baseline.critical) {
  console.error('The production dependency risk increased above the checked-in baseline.');
  process.exit(1);
}

console.log('Dependency audit baseline passed; high/critical risk did not increase.');
