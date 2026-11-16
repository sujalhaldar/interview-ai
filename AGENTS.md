# Interview AI — Agent Instructions

## Overview

Interview AI is a React/Vite frontend and Node.js/Express/Mongoose backend that compares a required job description and resume PDF, then presents a deterministic Resume Analysis V2 report. Gemini is used for qualitative analysis and for the explicitly requested Ideal Resume PDF flow.

The repository contains two applications: `Backend/` and `Frontend/`. MongoDB persistence is handled by the `InterviewReport` model and authenticated ownership is based on the internal MongoDB user `_id`.

## Engineering rules

- Inspect the architecture and `git status` before changing anything.
- Implement only the explicitly requested task or phase; avoid unrelated refactors.
- Preserve unrelated uncommitted work. Never reset, stash, discard, overwrite, or revert it without explicit authorization.
- Never commit, push, switch branches, or alter history unless explicitly authorized.
- Never modify `Backend/test-gemini.js`; it is intentionally untracked.
- Never read, print, expose, or commit environment secrets. Do not modify `.env` files unless explicitly instructed.
- Do not modify MongoDB records, drop collections, or alter indexes without explicit authorization.
- Do not install dependencies unless necessary and approved.
- Do not introduce architectural changes without evidence and justification.
- Report limitations honestly; do not claim browser verification when only automated checks ran.

## Authentication

Authentication is Google-only at the application level:

- `Frontend/src/features/auth/pages/Login.jsx` loads official Google Identity Services and sends the credential through `Frontend/src/features/auth/services/auth.api.js` to `POST /api/auth/google`.
- `Backend/src/services/google-auth.service.js` verifies Google ID tokens, including audience, issuer, subject, expiry/signature, and verified email.
- `googleSub` is the external identity key. MongoDB `_id` is the internal application identity.
- `Backend/src/controllers/auth.controller.js` creates or retrieves users by `googleSub`, then issues the application's JWT cookie. Google tokens are never application sessions.
- `GET /api/auth/get-me` resolves the current JWT user. `GET /api/auth/logout` clears the cookie and blacklists the current token.
- `Backend/src/middlewares/auth.middleware.js` remains authoritative for JWT verification, revocation, and expected-user identity consistency on protected `/api/interview` routes.
- Cross-tab signals only indicate that identity may have changed; they do not authenticate a user or expose tokens.
- Report queries use the authenticated internal user ID. Accounts are not silently merged based only on email.
- `/register` is retained as a compatibility redirect to `/login`; password registration/login endpoints and UI are removed.

## Resume Analysis V2

- Job Description and Resume PDF are required; Additional Background is optional.
- Initial analysis performs one qualitative Gemini call. JD extraction, resume evidence extraction, matching, scoring, mapping, and persistence are deterministic or local operations.
- Matching values are Matched `1`, Partial `0.5`, Needs verification `0.25`, Missing `0`.
- Priority weights are Required `1`, Preferred `0.5`, Unspecified `0.25`.
- Category weights are Technical skills `40%`, Experience `30%`, Tools `15%`, Education/certifications `15%`.
- Empty categories are excluded; if no scorable criteria exist, the score is `null`; rounding is applied only to the final score.
- Saving confirmed skills is deterministic and does not call Gemini. Confirmed skills must not fabricate employment, projects, durations, achievements, metrics, certifications, or education.
- Ideal Resume generation is a separate explicit user action.
- Historical V1 reports remain readable through model/adapter compatibility handling.

## Real-time analysis

Resume analysis uses the existing SSE-formatted response from the authenticated multipart POST route. The frontend parser is `Frontend/src/features/interview/services/interview.sse.js`; backend streaming is in `Backend/src/controllers/interview.controller.js`. Do not add queues, Redis, polling, or another job architecture without approval.

## Git and testing

Always inspect branch/status and preserve changes from other phases. Backend tests are defined by `Backend/package.json` (`npm test`); frontend tests, build, and lint are defined by `Frontend/package.json` (`npm test`, `npm run build`, `npm run lint`). Run relevant syntax checks and `git diff --check` for changes. Add regression coverage rather than deleting failing tests.
