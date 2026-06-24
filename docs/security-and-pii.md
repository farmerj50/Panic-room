# Security And PII Notes

This app handles sensitive personal information: account email/name, trusted contact names and phone numbers, emergency location, and media URLs.

Implemented controls:

- User accounts with bcrypt password hashing and JWT sessions.
- API routes for contacts, emergency events, and recordings require authentication.
- New backend records are scoped by `userId`.
- Contact names/phone numbers, account email/name, emergency coordinates, and recording URLs are encrypted before database storage.
- Contact PII is no longer persisted in mobile/web `AsyncStorage`; contacts are loaded from the authenticated backend.
- Journal notes and safety-plan data are stored as encrypted user-scoped backend blobs.
- Login/register endpoints have a basic in-memory rate limit.
- CORS defaults only allow local Expo origins unless `CORS_ORIGINS` is configured.

Deployment requirements:

- Serve the API and site over HTTPS only.
- Set unique production values for `JWT_SECRET` and `DATA_ENCRYPTION_KEY`.
- Store secrets in a secret manager or deployment environment, not in source control.
- Rotate `DATA_ENCRYPTION_KEY` with a planned re-encryption migration; changing it without migration makes existing encrypted values unreadable.
- Define retention/deletion policy for emergency events, location, recordings, journal notes, and account data.
- Review legal obligations for your jurisdiction before claiming regulatory compliance.

Known limits:

- JWTs are stored in `AsyncStorage`, which is acceptable for this app shell but not equivalent to an HTTP-only secure cookie on web.
- This implementation adds technical safeguards; it is not a legal certification.
