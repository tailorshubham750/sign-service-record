const http = require('http');

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:4000${urlPath}`, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
  });
}

(async () => {
  console.log('--- STARTING E2E SIGN & AUTO-UPLOAD TEST ---');

  // 1. Fetch CSR list or use HPHDPZXLCXTQ
  const refId = 'HPHDPZXLCXTQ';
  console.log(`Step 1: Creating signature link for ${refId}...`);

  // Simple 1x1 transparent PNG data URL for test signatures
  const sampleSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const linkRes = await postJson('/api/send-signature-link', {
    referenceId: refId,
    authorizedSignatoryName: 'Millan Parmar',
    authorizedSignatureDataUrl: sampleSig
  });

  console.log('Create Link Status:', linkRes.status);
  console.log('Token created:', linkRes.data.token);
  const token = linkRes.data.token;

  if (!token) {
    throw new Error('Failed to get token: ' + JSON.stringify(linkRes.data));
  }

  // 2. Submit both signatures
  console.log('Step 2: Submitting Customer & Authorized Signatures...');
  const submitRes = await postJson(`/api/submit-signature/${token}`, {
    signatureDataUrl: sampleSig,
    authorizedSignatureDataUrl: sampleSig,
    authorizedSignatoryName: 'Millan Parmar',
    agreedToTerms: true
  });

  console.log('Submit Signature Status:', submitRes.status);
  console.log('Submit Result:', JSON.stringify(submitRes.data, null, 2));

  // 3. Check signature status
  console.log('Step 3: Checking Signature Status API...');
  const statusRes = await getJson(`/api/signature-status/${token}`);
  console.log('Status API:', JSON.stringify(statusRes.data, null, 2));

  console.log('--- E2E TEST COMPLETED ---');
})();
