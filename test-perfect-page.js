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

function injectSignatureIntoJobsheet(html, customerSignatureUrl, authorizedSignatureUrl, authorizedSignatoryName = 'Millan Parmar', dateObj = new Date()) {
  if (!html) return html;
  
  const timeStr = formatTimestamp(dateObj);
  const authName = authorizedSignatoryName || 'Millan Parmar';

  // Inject CSS override to guarantee single-page fit and exact font styling
  const printStyle = `
    <style id="custom-single-page-style">
      @page {
        size: A4 portrait;
        margin: 3mm 4mm 3mm 4mm;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        font-family: GothamRoundedBook, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      #content {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 auto !important;
        padding: 0 !important;
      }
      thead { display: table-row-group !important; }
      tfoot { display: table-row-group !important; }
      .table-heading {
        font-size: 11px !important;
        padding: 3px 6px !important;
      }
      .table-content, .table-content-first-row {
        padding: 2.5px 6px !important;
        font-size: 9.5px !important;
      }
      .row-terms-and-conditions-div {
        width: 100% !important;
        padding-bottom: 8px !important;
      }
      .terms-and-conditions-section-table {
        margin-top: 4px !important;
      }
      .terms-and-conditions-section-table ol, 
      .terms-and-conditions-section-table p,
      .terms-and-conditions-section-table td {
        font-size: 7.2px !important;
        line-height: 1.15 !important;
      }
      .rowDiv4 {
        margin-top: 10px !important;
      }
      .disclamer-section-div {
        margin: 6px 0 0 0 !important;
      }
    </style>
  `;

  if (html.includes('</head>')) {
    html = html.replace('</head>', `${printStyle}</head>`);
  } else {
    html = printStyle + html;
  }

  // Exact signature block matching Image 1
  const signatureBlock = `
    <div class="rowDiv4" style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 15px; padding: 0 10px; width: 100%; box-sizing: border-box;">
        <!-- Left: Authorized Signatory -->
        <div class="authorized-signature-section-div" style="width: 230px; text-align: left;">
            <div style="margin-left: 2px; margin-bottom: 2px; min-height: 38px; display: flex; flex-direction: column; justify-content: flex-end;">
                ${authorizedSignatureUrl ? `
                    <img src="${authorizedSignatureUrl}" alt="Authorized Signature" style="max-height: 40px; max-width: 180px; display: block; object-fit: contain;" />
                ` : ''}
                <div style="font-family: GothamRoundedBook, -apple-system, sans-serif; font-size: 11px; color: #111; margin-top: 2px; font-weight: 500;">
                    (${timeStr})
                </div>
            </div>
            <div style="border-top: 1.5px solid #000; width: 210px; padding-top: 3px; text-align: left;">
                <p style="margin: 0; font-family: GothamRoundedBook, -apple-system, sans-serif; font-size: 11.5px; font-weight: bold; color: #111; line-height: 1.2;">Authorized Signatory</p>
                <p style="margin: 1px 0 0 0; font-family: GothamRoundedBook, -apple-system, sans-serif; font-size: 10.5px; color: #333; line-height: 1.2;">(${authName})</p>
            </div>
        </div>

        <!-- Right: Customer's Signature -->
        <div class="customer-signature-section-div" style="width: 230px; text-align: center;">
            <div style="margin-bottom: 2px; min-height: 38px; display: inline-block;">
                ${customerSignatureUrl ? `
                    <img src="${customerSignatureUrl}" alt="Customer Signature" style="max-height: 40px; max-width: 180px; display: block; margin: 0 auto; object-fit: contain;" />
                ` : ''}
                <div style="font-family: GothamRoundedBook, -apple-system, sans-serif; font-size: 11px; color: #111; margin-top: 2px; font-weight: 500; text-align: center;">
                    (${timeStr})
                </div>
            </div>
            <div style="border-top: 1.5px solid #000; width: 210px; margin-left: auto; margin-right: auto; padding-top: 3px; text-align: center;">
                <p style="margin: 0; font-family: GothamRoundedBook, -apple-system, sans-serif; font-size: 11.5px; font-weight: bold; color: #111; line-height: 1.2;">Customer's Signature</p>
            </div>
        </div>
    </div>
  `;

  const rowDiv4Regex = /<div class="rowDiv4">[\s\S]*?<\/table>\s*<\/div>\s*<\/div>/i;
  if (rowDiv4Regex.test(html)) {
    return html.replace(rowDiv4Regex, signatureBlock);
  }

  return html;
}

async function renderPerfectA4PDF(html) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Create drawn canvas signatures
  const [custSig, authSig] = await page.evaluate(() => {
    function makeSig(name) {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      if (name === 'cust') {
        ctx.moveTo(30, 50);
        ctx.bezierCurveTo(60, 20, 80, 70, 110, 40);
        ctx.bezierCurveTo(140, 20, 170, 60, 200, 35);
        ctx.bezierCurveTo(230, 25, 250, 45, 270, 30);
      } else {
        ctx.moveTo(25, 60);
        ctx.lineTo(45, 20);
        ctx.lineTo(65, 45);
        ctx.lineTo(85, 25);
        ctx.bezierCurveTo(110, 50, 140, 30, 170, 40);
        ctx.bezierCurveTo(200, 45, 230, 35, 260, 40);
      }
      ctx.stroke();
      return c.toDataURL('image/png');
    }
    return [makeSig('cust'), makeSig('auth')];
  });

  const timeStr = '28-09-2026 17:40';
  const signedHtml = injectSignatureIntoJobsheet(
    html,
    custSig,
    authSig,
    'Millan Parmar',
    new Date('2026-09-28T17:40:00')
  );

  await page.setContent(signedHtml, { waitUntil: 'load' });

  // Iteratively find scale that guarantees pageCount === 1 while keeping text crisp
  let chosenScale = 0.90;
  let pdfBuf = null;

  for (const s of [0.91, 0.89, 0.87, 0.85]) {
    pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      scale: s,
      margin: { top: '3mm', bottom: '3mm', left: '3mm', right: '3mm' }
    });

    const doc = await PDFDocument.load(pdfBuf);
    const count = doc.getPageCount();
    console.log(`Testing scale ${s}: pageCount = ${count}`);
    if (count === 1) {
      chosenScale = s;
      break;
    }
  }

  await browser.close();
  return { pdfBuf, chosenScale };
}

(async () => {
  const rawHtml = fs.readFileSync('/tmp/raw_jobsheet_HPHDPZXLCXTQ.html', 'utf8');
  
  const { pdfBuf, chosenScale } = await renderPerfectA4PDF(rawHtml);
  fs.writeFileSync('/tmp/test_perfect_1page.pdf', pdfBuf);
  console.log(`Generated /tmp/test_perfect_1page.pdf with scale ${chosenScale}, size: ${pdfBuf.length}`);

  const doc = await PDFDocument.load(pdfBuf);
  console.log('FINAL PDF PAGE COUNT:', doc.getPageCount());

  execSync('sips -s format png /tmp/test_perfect_1page.pdf --out /tmp/test_perfect_1page.png');
  console.log('Saved /tmp/test_perfect_1page.png');
})();
