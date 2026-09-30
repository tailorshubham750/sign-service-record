# Servify 360 — Sign Service Record

A production-ready fullstack automation system for **Servify 360** Service Records, featuring dual customer/supervisor signing, automatic PDF generation, and direct upload to Servify CSRs strictly attributed to the logged-in user.

---

## Features

- **Dual-Party Signing Workflow**:
  - **Link 1 (Customer)**: Optimized touch-friendly signature pad with pinch-to-zoom protection and terms acknowledgement.
  - **Link 2 (Authorized Signatory)**: Technician / supervisor authorization link.
  - Links remain live until **both** parties sign, then expire simultaneously.
- **Strict User Attribution**:
  - When uploading documents to Servify 360, the document is registered strictly under the account credentials and display name of the currently logged-in user.
- **Single-Device / Single-Browser Session Isolation**:
  - Cryptographically secure per-browser session tokens.
  - Logging into the same account from another browser gracefully logs out the previous session.
- **Encrypted Credential Vault**:
  - AES-256-GCM encryption with PBKDF2 salt derivation.
- **Zero-Config PDF Generation**:
  - High-fidelity A4 PDF compilation using headless Puppeteer with embedded signatures and exact timestamps.

---

## Quick Start

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# (Optional) Rebuild frontend if modifying React code
cd sign-app && npm install && npm run build && cd ..
```

### 2. Configure Environment

Create `.env` based on `.env.example`:

```env
PORT=4000
SERVIFY_BASE_URL=https://360.servify.in
```

### 3. Run the Server

```bash
node server.js
```

The server will be available at:
- **Local:** `http://localhost:4000`
- **LAN / Wi-Fi:** `http://<YOUR_LOCAL_IP>:4000`

---

## Project Structure

```
├── server.js              # Express API, auth sessions, PDF compilation, tunnel manager
├── servify-api.js         # Servify 360 Puppeteer automation, API client, document uploader
├── vault.js               # AES-256-GCM encrypted credential vault
├── sign-app/              # React 18 frontend dashboard & signing pages
│   ├── src/               # React components (LoginPage, SupervisorDashboard, SignPage)
│   └── build/             # Production compiled frontend assets
├── package.json           # Root dependencies & scripts
└── .env.example           # Environment template
```
