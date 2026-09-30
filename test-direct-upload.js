const fs = require('fs');
const path = require('path');
const https = require('https');
const { login, ensureSession } = require('./servify-api');
require('dotenv').config();

// We need a multipart/form-data builder without external heavy dependencies
function buildMultipartBody(fields, files, boundary) {
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
  }

  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function uploadPdfToServify(csrId, pdfBuffer, fileName) {
  const cookies = await login(process.env.SERVIFY_USERNAME, process.env.SERVIFY_PASSWORD);
  const auth = cookies.authorization;

  // Step 1: Upload to docService
  console.log('[Upload] Step 1: Sending file to docService/api/v1/internal/document/upload...');
  const boundary = '----NodeUploadBoundary' + Math.random().toString(36).substring(2);

  const fields = {
    docType: 'ConsumerServiceRequestDocument',
    clientRefId: `FEWEBA-${Math.random().toString(36).substring(2)}.pdf`,
    'entity-type': 'ConsumerServiceRequest',
    'entity-id': csrId
  };

  const files = [
    {
      fieldname: 'file',
      filename: fileName,
      contentType: 'application/pdf',
      buffer: pdfBuffer
    }
  ];

  const multipartBody = buildMultipartBody(fields, files, boundary);

  const docServiceRes = await new Promise((resolve, reject) => {
    const req = https.request('https://api.servify.in/docService/api/v1/internal/document/upload', {
      method: 'POST',
      headers: {
        'authorization': auth,
        'app': 'WebApp',
        'module': 'WebApp',
        'Origin': 'https://360.servify.in',
        'Referer': 'https://360.servify.in/',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });

    req.on('error', reject);
    req.write(multipartBody);
    req.end();
  });

  console.log('[Upload] docService status:', docServiceRes.status);
  console.log('[Upload] docService res:', JSON.stringify(docServiceRes.data, null, 2));

  if (!docServiceRes.data || !docServiceRes.data.success || !docServiceRes.data.data) {
    throw new Error('docService upload failed: ' + JSON.stringify(docServiceRes.data));
  }

  const docData = docServiceRes.data.data;
  const docUUID = docData.docServiceUUID || docData.docID;
  const uploadURL = docData.uploadURL || `docID=${docUUID}`;
  const fileUrl = docData.url;

  console.log(`[Upload] File uploaded to docService successfully! docUUID: ${docUUID}`);

  // Step 2: Register Document in Servify CSR via addDocsForDS
  console.log('[Upload] Step 2: Registering document with addDocsForDS...');
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

  const registerPayload = JSON.stringify({
    updatedData: [
      {
        ConsumerServiceRequestID: csrId,
        FilePath: uploadURL,
        Type: 'pdf',
        FileName: docUUID,
        OriginalName: fileName,
        Tag: 'Signed Service Record',
        DocumentID: 28,
        app: 'WebApp',
        DocumentCode: 'JOBSHEET',
        FileUrl: fileUrl
      }
    ]
  });

  const registerRes = await new Promise((resolve, reject) => {
    const req = https.request('https://360.servify.in/api/v1/ConsumerServicerequest/addDocsForDS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cookie': cookieHeader,
        'authorization': auth,
        'Origin': 'https://360.servify.in',
        'Referer': 'https://360.servify.in/servicerequests',
        'UUID': Math.random().toString(36).substring(2),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });

    req.on('error', reject);
    req.write(registerPayload);
    req.end();
  });

  console.log('[Upload] addDocsForDS status:', registerRes.status);
  console.log('[Upload] addDocsForDS res:', JSON.stringify(registerRes.data, null, 2));

  return { docServiceRes, registerRes };
}

(async () => {
  try {
    const csrId = 'AW2N8PKkWYs1P68I7Y8aMhPZau5mMI2g0Q5O4syJOH_SqnZ8QQGY7g=='; // D57GG3ZT7ARU
    const pdfDir = path.join(__dirname, 'signed_pdfs');
    const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
    const testPdfPath = path.join(pdfDir, pdfFiles[0]);
    const pdfBuffer = fs.readFileSync(testPdfPath);

    await uploadPdfToServify(csrId, pdfBuffer, '20260929210000_D57GG3ZT7ARU_JobSheet.pdf');
    console.log('--- TEST FINISHED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Test error:', err);
  }
})();
