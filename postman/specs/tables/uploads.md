# uploads — implemented

Image bytes in, a public URL out. The URL is what `products.imageUrls`,
`users.photo`, `messages.imageUrl` and the listing agent (`imageUrls` on
`/api/ai/chat`) already take, so nothing else changed shape.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/uploads/images` | JWT | raw image, `Content-Type: image/jpeg \| image/png \| image/webp`, max 8 MB | `201 {item: {url, contentType, size}}` | `400 VALIDATION` (empty body), `401`, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE` (other type, or bytes that do not match it), `429 RATE_LIMITED` |
| GET | `/uploads/<name>` | none | — | the stored file, `Cache-Control: immutable` | `404` |

## Rules

| Rule | Why |
|---|---|
| One raw image per request, not multipart | no parser dependency; the phone streams a file straight from disk |
| The leading bytes must match the declared type | a script labelled `image/png` is refused instead of served from our origin |
| The server names the file (cuid2 + extension) | no client path to traverse, no collisions |
| `url` is built on `PUBLIC_BASE_URL`, else the request origin | the device that uploaded can always open it (LAN IP in development) |
| Rate limit 120 per 15 minutes per IP | an open upload route is free hosting |

Files live in `UPLOAD_DIR` (default `<repo>/uploads`, git-ignored). Under PM2
cluster mode or several hosts that directory must be shared storage.
