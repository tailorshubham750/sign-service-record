const puppeteer = require('puppeteer');
const fs = require('fs');
const { execSync } = require('child_process');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  
  const rawHtml = fs.readFileSync('/tmp/raw_jobsheet_HPHDPZXLCXTQ.html', 'utf8');

  const configs = [
    { name: 'scale_95', scale: 0.95, margin: { top: '5mm', bottom: '5mm', left: '5mm', right: '5mm' } },
    { name: 'scale_90', scale: 0.90, margin: { top: '4mm', bottom: '4mm', left: '4mm', right: '4mm' } },
    { name: 'scale_85', scale: 0.85, margin: { top: '3mm', bottom: '3mm', left: '3mm', right: '3mm' } },
    { name: 'scale_82', scale: 0.82, margin: { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' } },
    { name: 'scale_80', scale: 0.80, margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' } }
  ];

  for (const cfg of configs) {
    const page = await browser.newPage();
    await page.setContent(rawHtml, { waitUntil: 'load' });
    
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      scale: cfg.scale,
      margin: cfg.margin
    });
    
    const str = pdfBuf.toString('latin1');
    const pageCount = (str.match(/\/Type\s*\/Page\b/g) || []).length;
    console.log(`Config ${cfg.name}: pages = ${pageCount}`);
    
    if (pageCount === 1) {
      fs.writeFileSync(`/tmp/test_${cfg.name}.pdf`, pdfBuf);
      execSync(`sips -s format png /tmp/test_${cfg.name}.pdf --out /tmp/test_${cfg.name}.png`);
      console.log(`Saved /tmp/test_${cfg.name}.png`);
    }
    await page.close();
  }

  await browser.close();
})();
