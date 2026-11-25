// Builds the site and publishes dist/ to the gh-pages branch of this repository's "origin" remote.
// GitHub Pages serves that branch. Run it with `npm run deploy` from the project folder.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
const out = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options }).trim();

run('npm', ['run', 'build']);
const remote = out('git', ['remote', 'get-url', 'origin']);
const name = out('git', ['config', 'user.name']);
const email = out('git', ['config', 'user.email']);
const message = process.env.DEPLOY_MESSAGE || 'Publish the built site';

const tmp = mkdtempSync(join(tmpdir(), 'pages-'));
try {
  cpSync('dist', tmp, { recursive: true });
  writeFileSync(join(tmp, '.nojekyll'), ''); // serve the files as they are, without Jekyll
  const git = (...args) => run('git', args, { cwd: tmp });
  git('init', '-q', '-b', 'gh-pages');
  git('config', 'user.name', name);
  git('config', 'user.email', email);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  git('push', '-f', remote, 'gh-pages');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
