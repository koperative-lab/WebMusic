const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const artifacts = process.env.WEBMUSIC_ACCEPTANCE_OUTPUT ?? path.join(require('node:os').tmpdir(), 'webmusic-modular-third');
fs.mkdirSync(artifacts, {recursive: true});
(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEBMUSIC_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(process.env.MODULAR_THIRD_TIMING_URL ?? 'http://127.0.0.1:8767/modular-third-timing.html');
    await page.waitForFunction(() => typeof window.runModularThirdTiming === 'function');
    const result = await page.evaluate(() => window.runModularThirdTiming());
    const evidence = {executedAt: new Date().toISOString(), browserVersion: browser.version(),
      build: JSON.parse(fs.readFileSync(path.join(artifacts, 'modular-third-timing-build.json'), 'utf8')), ...result, browserErrors: errors};
    fs.writeFileSync(path.join(artifacts, 'modular-third-timing-results.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({passed: evidence.passed, tests: evidence.tests.map(test => ({name: test.name, passed: test.passed, error: test.error})), browserErrors: errors}, null, 2));
    if (!evidence.passed || errors.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
