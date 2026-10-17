import { launchChrome, fileUrl } from './cdp.mjs';

const probePagePath = process.argv[2];
const headless = process.argv[3] !== 'headed';
const browser = await launchChrome({ headless });
try {
  const page = await browser.newPage();
  await page.setViewport(1728, 1117, 2);
  await page.goto(fileUrl(probePagePath));
  const result = await page.evaluate('window.probe');
  console.log(JSON.stringify(result, null, 2));
  if (page.consoleMessages.length) console.log(page.consoleMessages.join('\n'));
} finally {
  await browser.shutdown();
}
