const puppeteer = require('puppeteer');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { execSync } = require('child_process');

function formatTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day}-${month}-${year} ${hours}:${mins}`;
}

function injectExactSignatures(html, customerSignatureUrl, authorizedSignatureUrl, authorizedSignatoryName = 'Millan Parmar', dateObj = new Date()) {
  if (!html) return html;
  
  const timeStr = formatTimestamp(dateObj);
  const authName = authorizedSignatoryName || 'Millan Parmar';

  const exactRowDiv4 = `
    <div class="rowDiv4" style="display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: 20px;">
        <div class="authorized-signature-section-div" style="width: 50%; text-align: left;">
            <table class="authorized-signature-section-table" style="width: 100%; border-collapse: collapse; border: none !important;">
                <tr>
                    <td colspan="2" style="border: none !important; text-align: left; padding: 0 0 2px 8px; vertical-align: bottom; height: 50px;">
                        ${authorizedSignatureUrl ? `
                            <img src="${authorizedSignatureUrl}" alt="Authorized Signature" style="max-height: 42px; max-width: 190px; display: block; object-fit: contain;" />
                        ` : ''}
                        <div style="font-family: GothamRoundedBook, sans-serif; font-size: 11px; margin-top: 2px; font-weight: 500; color: #111;">
                            (${timeStr})
                        </div>
                    </td>
                    <td style="border: none !important;"></td>
                    <td style="border: none !important;"></td>
                </tr>
                <tr>
                    <td class="table-heading text-bold" colspan="2" style="vertical-align: top; text-align: left; border: none !important; border-top: 1px solid black !important; width: 220px; padding: 4px 0 0 8px;">
                        <p style="margin: 0; font-family: GothamRoundedBook, sans-serif; font-size: 12px; font-weight: bold; color: #111;">Authorized Signatory</p>
                        <p style="margin: 1px 0 0 0; font-family: GothamRoundedBook, sans-serif; font-size: 11px; font-weight: normal; color: #222;">(${authName})</p>
                    </td>
                    <td style="border: none !important;"></td>
                    <td style="border: none !important;"></td>
                </tr>
            </table>
        </div>
        <div class="customer-signature-section-div" style="width: 50%; text-align: right;">
            <table class="customer-signature-section-table" style="width: 100%; border-collapse: collapse; border: none !important;">
                <tr>
                    <td style="border: none !important;"></td>
                    <td style="border: none !important;"></td>
                    <td colspan="2" style="border: none !important; text-align: center; padding: 0 8px 2px 0; vertical-align: bottom; height: 50px; width: 220px; margin-left: auto;">
                        ${customerSignatureUrl ? `
                            <img src="${customerSignatureUrl}" alt="Customer Signature" style="max-height: 42px; max-width: 190px; display: block; margin: 0 auto; object-fit: contain;" />
                        ` : ''}
                        <div style="font-family: GothamRoundedBook, sans-serif; font-size: 11px; margin-top: 2px; font-weight: 500; color: #111; text-align: center;">
                            (${timeStr})
                        </div>
                    </td>
                </tr>
                <tr>
                    <td style="border: none !important;"></td>
                    <td style="border: none !important;"></td>
                    <td class="table-heading text-bold" colspan="2" style="vertical-align: top; text-align: center; border: none !important; border-top: 1px solid black !important; width: 220px; padding: 4px 8px 0 0;">
                        <p style="margin: 0; font-family: GothamRoundedBook, sans-serif; font-size: 12px; font-weight: bold; color: #111;">Customer's Signature</p>
                    </td>
                </tr>
            </table>
        </div>
    </div>
  `;

  const rowDiv4Regex = /<div class="rowDiv4">[\s\S]*?<\/table>\s*<\/div>\s*<\/div>/i;
  if (rowDiv4Regex.test(html)) {
    return html.replace(rowDiv4Regex, exactRowDiv4);
  }

  return html;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const rawHtml = fs.readFileSync('/tmp/raw_jobsheet_HPHDPZXLCXTQ.html', 'utf8');

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1600 });

  // Generate realistic signatures matching Image 1
  const [custSig, authSig] = await page.evaluate(() => {
    function makeSig(name) {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 90;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      if (name === 'auth') {
        // Milan cursive signature
        ctx.moveTo(30, 65);
        ctx.lineTo(45, 25);
        ctx.lineTo(60, 55);
        ctx.lineTo(75, 25);
        ctx.lineTo(90, 65);
        ctx.bezierCurveTo(110, 65, 125, 40, 140, 45);
        ctx.bezierCurveTo(155, 50, 165, 65, 185, 65);
        ctx.bezierCurveTo(200, 65, 220, 45, 240, 60);
      } else {
        // Customer cursive signature
        ctx.moveTo(40, 55);
        ctx.bezierCurveTo(60, 20, 85, 75, 110, 45);
        ctx.bezierCurveTo(130, 25, 150, 65, 180, 40);
        ctx.bezierCurveTo(210, 25, 240, 55, 270, 35);
      }
      ctx.stroke();
      return c.toDataURL('image/png');
    }
    return [makeSig('cust'), makeSig('auth')];
  });

  const finalHtml = injectExactSignatures(
    rawHtml,
    custSig,
    authSig,
    'Millan Parmar',
    new Date('2026-09-28T17:40:00')
  );

  await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

  // Render with scale 0.92 and 0 margin
  const pdfBuf = await page.pdf({
    format: 'A4',
    printBackground: true,
    scale: 0.92,
    margin: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  const doc = await PDFDocument.load(pdfBuf);
  console.log('PDF Page count:', doc.getPageCount());

  fs.writeFileSync('/tmp/exact_100_percent_match.pdf', pdfBuf);
  execSync('sips -s format png /tmp/exact_100_percent_match.pdf --out /tmp/exact_100_percent_match.png');
  console.log('Saved /tmp/exact_100_percent_match.png');

  await browser.close();
})();
