# DocVerify

Document authenticity verification via QR codes.

## How it works

1. Your system calls `POST /api/documents` when issuing a document
2. The API returns a unique document ID + a QR code image (PNG / base64)
3. The QR is embedded on the printed or PDF document
4. Anyone who scans the QR lands on `GET /verify?doc=DOC-XXXXXXXX-XXXXXXXX`
5. The page looks up the ID in your database and shows: Verified, Revoked, or Not Found

---

## Setup

### 1. Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env with your DB credentials and your public domain
```

### 4. Run DB migration
```bash
npm run migrate
```

### 5. Start the server
```bash
# Development
npm run dev

# Production
npm start
```

---

## API Reference

### Create a document

```
POST /api/documents
Content-Type: application/json
```

**Body:**
```json
{
  "title": "Certificate of Incorporation",
  "issued_to": "Acme Corporation Ltd",
  "issued_by": "Your Company Name",
  "doc_type": "Certificate",
  "expiry_date": "2026-12-31",
  "prefix": "CERT",
  "metadata": {
    "Registration Number": "RC-12345678",
    "Registered Address": "123 Business Park, Lagos"
  }
}
```

**Response:**
```json
{
  "document": {
    "id": "...",
    "doc_id": "CERT-20241215-A3F9K2M1",
    "title": "Certificate of Incorporation",
    "status": "active",
    ...
  },
  "qr": {
    "dataUrl": "data:image/png;base64,...",
    "url": "https://yourcompany.com/verify?doc=CERT-20241215-A3F9K2M1"
  }
}
```

### Download QR code as PNG

```
GET /api/documents/:docId/qr
```

Returns a `image/png` file. Embed this in your PDF or print workflow.

### Download generated PDF

```
GET /api/documents/:docId/pdf
```

Returns a complete PDF with the document details and an embedded QR code.

### Revoke a document

```
PATCH /api/documents/:docId/revoke
```

Once revoked, the verify page shows it as invalid. Cannot be undone via API (intentional).

### List documents

```
GET /api/documents?page=1&limit=20&status=active
```

### Check document status (JSON)

```
GET /verify/api/:docId
```

Returns:
```json
{
  "valid": true,
  "status": "active",
  "document": { ... }
}
```

### Public verify page (HTML)

```
GET /verify?doc=DOC-20241215-A3F9K2M1
```

This is what QR codes point to. Returns a human-readable HTML page.

---

## Embedding QR codes in your own PDF workflow

If you generate PDFs elsewhere (Word, another library, etc.), just fetch the QR PNG:

```bash
# Get QR for a document
GET /api/documents/DOC-20241215-A3F9K2M1/qr
# → returns PNG, save and embed in your document
```

Or use the base64 `dataUrl` from the create response and embed it directly.

---

## Production checklist

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Set `BASE_URL` to your actual public domain
- [ ] Put the app behind nginx with HTTPS (QR codes must use HTTPS)
- [ ] Set `trust proxy` correctly for your load balancer
- [ ] Restrict `/api/documents` to internal network or add API key auth
- [ ] Keep `/verify` public (that's what QR codes hit)
- [ ] Set up PostgreSQL backups

## Nginx config snippet (production)

```nginx
server {
    listen 443 ssl;
    server_name yourcompany.com;

    location /verify {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }

    location /api/ {
        # Restrict to internal only in production
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://localhost:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
