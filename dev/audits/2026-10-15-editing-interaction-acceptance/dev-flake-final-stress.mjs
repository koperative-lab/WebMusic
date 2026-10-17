import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const limit = 50;
const results = [];
for (let index = 0; index < limit; index++) {
  const started = Date.now();
  let output = '';
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'check:dev-server'], {
      cwd: '/Users/mamingchen/.codex/worktrees/cd78/WebMusic',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({run: index + 1, code, signal, milliseconds: Date.now() - started}));
  });
  results.push(result);
  if (result.code !== 0) {
    await writeFile(`/tmp/webmusic-dev-flake-final-stress-failure-${index + 1}.log`, output);
    console.log(JSON.stringify({...result, output}));
    break;
  }
  if ((index + 1) % 10 === 0) console.log(JSON.stringify({passed: index + 1, elapsedMs: results.reduce((sum, item) => sum + item.milliseconds, 0)}));
}
await writeFile('/tmp/webmusic-dev-flake-final-stress-results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({total: results.length, passed: results.filter(result => result.code === 0).length, failed: results.filter(result => result.code !== 0).length}));
