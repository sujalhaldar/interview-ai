# Changelog

This is a concise engineering history based on repository commits and verified implementation work. It intentionally does not invent dates, hashes, or push status.

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
