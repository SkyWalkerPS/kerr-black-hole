import { readFileSync } from 'node:fs';
import { launchChrome } from './cdp.mjs';

const imagePaths = process.argv.slice(2);
if (!imagePaths.length) {
  console.error('usage: node tools/measure-sky.mjs <screenshot.png> [...]');
  process.exit(1);
}

const measureInPage = `async (dataUrl) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
  const lumaAt = (index) => 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  const tileSize = 96;
  const tileColumns = Math.floor(width / tileSize);
  const tileRows = Math.floor(height / tileSize);
  const tileBackgrounds = [];
  let starPixels = 0;
  let brightStarPixels = 0;
  let pixelCount = 0;
  for (let tileRow = 0; tileRow < tileRows; tileRow++) {
    for (let tileColumn = 0; tileColumn < tileColumns; tileColumn++) {
      const histogram = new Uint32Array(256);
      for (let y = tileRow * tileSize; y < (tileRow + 1) * tileSize; y++) {
        for (let x = tileColumn * tileSize; x < (tileColumn + 1) * tileSize; x++) {
          histogram[Math.min(255, Math.round(lumaAt((y * width + x) * 4)))]++;
        }
      }
      let cumulative = 0;
      let background = 0;
      for (let level = 0; level < 256; level++) {
        cumulative += histogram[level];
        if (cumulative >= tileSize * tileSize * 0.5) { background = level; break; }
      }
      tileBackgrounds.push({ tileRow, tileColumn, background, histogram });
    }
  }
  const sortedBackgrounds = tileBackgrounds.map((tile) => tile.background).sort((a, b) => a - b);
  const darkestQuarter = tileBackgrounds.filter((tile) => tile.background <= sortedBackgrounds[Math.floor(sortedBackgrounds.length * 0.25)]);
  for (const tile of darkestQuarter) {
    for (let level = 0; level < 256; level++) {
      pixelCount += tile.histogram[level];
      if (level >= tile.background + 24) starPixels += tile.histogram[level];
      if (level >= 160) brightStarPixels += tile.histogram[level];
    }
  }
  let seamSteps = 0;
  for (const tile of tileBackgrounds) {
    const right = tileBackgrounds.find((other) => other.tileRow === tile.tileRow && other.tileColumn === tile.tileColumn + 1);
    const below = tileBackgrounds.find((other) => other.tileRow === tile.tileRow + 1 && other.tileColumn === tile.tileColumn);
    for (const neighbour of [right, below]) {
      if (neighbour && Math.abs(neighbour.background - tile.background) >= 3 && Math.max(neighbour.background, tile.background) < 40) seamSteps++;
    }
  }
  return {
    size: width + 'x' + height,
    darkSkyMedianLevel: sortedBackgrounds[Math.floor(sortedBackgrounds.length * 0.25)],
    darkestTileLevel: sortedBackgrounds[0],
    starPixelPercentInDarkSky: +(100 * starPixels / Math.max(pixelCount, 1)).toFixed(3),
    brightStarPixelPercentInDarkSky: +(100 * brightStarPixels / Math.max(pixelCount, 1)).toFixed(4),
    darkTileStepsOf3Levels: seamSteps,
  };
}`;

const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  for (const imagePath of imagePaths) {
    const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`;
    const result = await page.evaluate(`(${measureInPage})(${JSON.stringify(dataUrl)}).then((r) => JSON.stringify(r))`);
    console.log(imagePath.split('/').slice(-2).join('/'), result);
  }
} finally {
  await browser.shutdown();
}
