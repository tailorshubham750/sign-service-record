const puppeteer = require('puppeteer');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { execSync } = require('child_process');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const rawHtml = fs.readFileSync('/tmp/raw_jobsheet_HPHDPZXLCXTQ.html', 'utf8');

  // Let's test different puppeteer options on rawHtml
  const tests = [
    { name: 't1_zero_margin_scale1', margin: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 1.0 },
    { name: 't2_zero_margin_scale098', margin: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 0.98 },
    { name: 't3_zero_margin_scale095', margin: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 0.95 },
    { name: 't4_zero_margin_scale092', margin: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 0.92 },
    { name: 't5_zero_margin_scale090', margin: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 0.90 },
  ];

  for (const t of tests) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.setContent(rawHtml, { waitUntil: 'networkidle0' });

    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: t.margin,
      scale: t.scale
    });

    const doc = await PDFDocument.load(pdfBuf);
    const count = doc.getPageCount();
    console.log(`${t.name}: pages = ${count}`);

    if (count === 1) {
      fs.writeFileSync(`/tmp/${t.name}.pdf`, pdfBuf);
      execSync(`sips -s format png /tmp/${t.name}.pdf --out /tmp/${t.name}.png`);
      console.log(`Saved /tmp/${t.name}.png`);
    }
    await page.close();
  }

  await browser.close();
})();
