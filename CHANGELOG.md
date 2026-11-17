# Changelog

This is a concise engineering history based on repository commits and verified implementation work. It intentionally does not invent dates, hashes, or push status.

## Phase 5 security hardening — presentation closure

- Hardened JWT signing/verification, cookie attributes and expiration, startup secret validation, and session failure handling.
- Added canonical CSRF/CORS origin validation and protection for authenticated state-changing routes. Logout is now `POST /api/auth/logout`; the state-changing report GET was made read-only and report-open tracking moved to a protected PATCH endpoint.
- Added Google authentication rate limiting, hashed blacklist lookup with legacy compatibility, TTL index startup verification, deleted-user handling, and centralized frontend authentication transition coordination.
- Verification: backend 178 passed, frontend 19 passed, frontend production build passed, targeted ESLint passed, backend syntax checks passed, and `git diff --check` passed with existing LF/CRLF warnings. Existing Sass deprecation warnings remain.
- Phase 5 is **CLOSED FOR PRESENTATION MILESTONE**, not production security certification. Deferred limitations include the browser-level logout `Set-Cookie` race, `/get-me` expected-identity consistency, process-local rate limiting, static (non-runtime) frontend race tests, duplicate auth consumers and cross-tab nonce deduplication, missing Google ID-token nonce binding, and the existing Fast Refresh lint issue.

## Resume Analysis V2

- Added deterministic JD requirement extraction, resume evidence extraction, requirement matching, category scoring, report mapping, confirmed-skills recalculation, and V1-compatible persistence/rendering.
- Kept one qualitative Gemini call for initial analysis and separate explicit Ideal Resume generation.

## SSE analysis progress

- Added four-stage SSE-formatted resume-analysis progress, frontend parsing, terminal completion/error handling, and idempotency/concurrency protection.

## History management

- Added deterministic report titles, pin/unpin metadata, history ordering, last-opened tracking, owner-scoped deletion, rename/pin/delete APIs, and frontend history actions.

## Authentication and session isolation

- Added expected-user identity consistency checks, cross-tab identity invalidation, request-generation guards, and separation of history loading from analysis loading.

## Google OAuth

- Added backend Google ID-token verification, Google-subject user lookup/creation, JWT-cookie issuance, and Google authentication integration tests.
- Added official Google Identity Services frontend integration, callback/error/loading handling, duplicate-callback protection, and authenticated redirect behavior.
- Added a visible logout action using the existing JWT logout/blacklist flow.
- Removed password authentication from the current working tree: password routes, bcrypt usage, password schema/API/UI, and registration UI were removed; `/register` redirects to `/login`.

## Database cleanup

- User-reported manual cleanup removed disposable test users, reports, and analysis-idempotency records while preserving the blacklist collection/document. This was not performed by the documentation task and should not be repeated without explicit authorization.

## Google-only authentication checkpoint

- Checkpoint `a007a24` (`feat(auth): migrate to Google-only authentication`) records the completed Google-only migration.
- Branch `feature/google-oauth-implementation` was created from `feature/resume-analysis-redesign` and pushed to `origin/feature/google-oauth-implementation`. No pull request was created and no merge to `main` occurred.

## Phase 5C security hardening

- Added CSRF middleware with canonical URL-origin normalization and validation, using the same normalized allowlist for CORS and CSRF across authenticated state-changing routes.
- Migrated logout to `POST /api/auth/logout`; GET logout no longer performs the state-changing operation.
- Added security regression coverage for origin validation, configuration failures, and rejected logout requests. Validation completed with 156 backend tests, 20 focused CSRF tests, 15 frontend tests, passing syntax checks, and `git diff --check`.
