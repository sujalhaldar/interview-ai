# Resume Analysis Specification

## 1. Product objective and scope

Resume Analysis compares a candidate's resume and optional self-description against a target job description. It produces an explainable, evidence-backed assessment, identifies actionable gaps, and creates a preparation roadmap.

The first milestone covers analysis, roadmap generation, and PDF exports. Interactive technical and behavioral interviewing is explicitly outside this interface and is reserved for a future Mock Interview workflow.

The system must distinguish evidence found in the candidate inputs from assumptions or items that require verification. It must not invent experience, qualifications, or achievements.

## 2. Interface structure

The analysis view uses a three-column layout.

### Left navigation

The left navigation contains:

- Overall Summary
- Keyword & Skill Breakdown
- Experience Alignment
- Education & Certification Check
- Tone & Style Analysis
- Preparation Roadmap

Sticky actions are available from the analysis view:

- Download Ideal Resume
- Download Analysis Report

### Center panel

The center panel dynamically displays the content for the selected navigation item. Switching sections must not require a new AI request when the complete report is already loaded.

### Right panel

The right panel remains visible while navigating and contains:

- Overall match score
- Category score breakdown
- Critical skill gaps
- Preparation progress

Preparation progress reflects roadmap task completion. It must never mutate or overwrite the original resume match score.

## 3. Evidence-backed analysis requirements

The analysis response must distinguish evidence, interpretation, and uncertainty.

### Strengths

List strengths supported by the resume or self-description. Each strength should include the relevant evidence or source context where practical.

### Areas of Improvement

Identify weaknesses or opportunities that affect the target role. Recommendations should be tied to a job requirement or a clearly identified resume weakness.

### Resume Gaps

Identify missing or insufficiently demonstrated content, such as absent keywords, missing project evidence, unclear impact, or incomplete role context. A gap means the resume does not adequately demonstrate something; it does not prove the candidate lacks the skill.

### Skill classification

Skills and requirements should be classified as:

- **Matched** — supported by explicit candidate evidence and aligned with the target JD.
- **Missing** — required or strongly expected by the JD but not evidenced in the submitted materials.
- **Bonus** — useful or differentiating evidence that is not essential to the core match.
- **Needs Verification** — mentioned ambiguously, without enough detail, or requiring confirmation.

### Experience alignment

Evaluate alignment between the target role and the candidate's demonstrated:

- Responsibilities
- Seniority and scope
- Technical or domain experience
- Measurable outcomes
- Recency and relevance

The analysis should identify both aligned evidence and specific missing context.

### Education and certification check

Compare listed education and certifications with explicit or preferred JD requirements. Report:

- Direct matches
- Relevant but non-equivalent credentials
- Missing required credentials
- Credentials that need verification

Do not infer a credential that is not present.

### Tone, writing, formatting, and ATS-risk analysis

Assess:

- Clarity and concision
- Professional tone
- Grammar and consistency
- Verb strength and specificity
- Formatting consistency
- Heading and section structure
- Keyword placement
- ATS risks such as tables, columns, decorative elements, ambiguous headings, or unreadable content

The analysis must describe detected risks and recommended corrections rather than claiming compatibility with every ATS.

## 4. Scoring principles

Scoring must be explainable and evidence-based.

- Category assessments must cite or summarize the evidence used.
- Scores must be bounded and validated by the backend.
- Missing evidence must not automatically be treated as proof of missing ability.
- The system must distinguish a low score caused by absent evidence from a contradiction in the candidate materials.
- The backend must calculate the final overall score deterministically from validated category scores.
- The AI may propose evidence and category assessments, but it must not be the sole authority for the final arithmetic.

The category list and weighting model are not finalized. Category weights require product approval before implementation. No scoring weights should be hardcoded as final until that approval is recorded.

## 5. Preparation roadmap

### Configuration

- `durationDays`: integer from 1 through 30; default `7`.
- `dailyHours`: integer from 1 through 8; default `3`.
- `strategy`: one of `urgent`, `balanced`, or `zero-to-hero`.

These values must be validated server-side and persisted with the report.

### Strategies

**Urgent**

Prioritizes the highest-impact JD requirements and critical gaps for near-term interview readiness. Lower-value breadth may be deferred.

**Balanced**

Balances foundational learning, practical application, resume improvements, and interview preparation within a sustainable daily workload.

**Zero-to-Hero**

Assesses the candidate's current knowledge, identifies prerequisite gaps, and generates a progressive curriculum mapped to the target JD. The sequence must move from prerequisites to fundamentals, guided practice, independent application, and role-specific readiness. Advanced topics must not be scheduled before their required foundations.

### Progress behavior

Completing roadmap tasks updates preparation progress only. It must never change the stored original resume match score or rewrite the original analysis evidence.

The report should preserve the original roadmap configuration and analysis snapshot so later progress is auditable.

## 6. PDF exports

The analysis view provides two exports:

### Ideal Resume

An ATS-oriented, job-tailored resume generated from the candidate inputs and target JD. It must not invent qualifications or experience.

### Complete Analysis Report

A report containing the analysis sections, evidence, category scores, skill classifications, identified risks, roadmap configuration, and preparation plan.

The export endpoints must enforce authenticated ownership of the underlying report.

## 7. Future Mock Interview workflow

Technical and behavioral interview questions are not displayed in Resume Analysis.

Their separation must be preserved for a future Mock Interview workflow, which may use the existing question data or a separate report/workflow contract. Resume Analysis navigation and components must not couple its core experience to interactive questioning.

## 8. Technical architecture

### Existing stack

- React and React Router frontend
- Express backend
- Gemini via `@google/genai`
- Zod response schemas
- MongoDB through Mongoose
- Puppeteer for resume PDF generation
- JWT authentication in cookies

### Existing flow

1. The React input page submits a job description, optional PDF resume, and optional self-description.
2. Express authenticates the request and parses the uploaded PDF in memory.
3. The AI service receives extracted resume text, self-description, and job description.
4. The AI returns JSON conforming to a Zod-derived schema.
5. The controller stores the source inputs and AI output in an `InterviewReport` MongoDB document.
6. The frontend retrieves the report by ID and renders the current analysis page.
7. The resume PDF endpoint retrieves an owned report, asks Gemini for tailored HTML, and uses Puppeteer to produce the PDF.

Relevant existing files:

- `Frontend/src/features/interview/pages/Home.jsx`
- `Frontend/src/features/interview/pages/Interview.jsx`
- `Frontend/src/features/interview/hooks/useInterview.js`
- `Frontend/src/features/interview/services/interview.api.js`
- `Backend/src/services/ai.service.js`
- `Backend/src/controllers/interview.controller.js`
- `Backend/src/models/interviewReport.model.js`

### New AI response contract

The redesigned contract must add validated fields for at least:

- Strengths with evidence
- Areas of improvement with evidence or rationale
- Resume gaps
- Skill classifications: Matched, Missing, Bonus, Needs Verification
- Experience alignment findings
- Education and certification findings
- Tone, writing, formatting, and ATS-risk findings
- Category scores with evidence summaries
- Roadmap configuration and day-by-day plan

The contract must use bounded numbers, enums, required structure, and length limits appropriate for the UI. The backend must validate and normalize the response before persistence.

### Persistence requirements

The report model needs fields for the new analysis output and roadmap configuration. Existing source inputs should remain distinguishable from generated analysis. Existing technical and behavioral question fields may be retained for future Mock Interview support, but they should not be rendered in Resume Analysis.

## 9. Implementation milestones and testing

### Milestone 1 — Contract and persistence

1. Obtain product approval for score categories and weights.
2. Define the versioned AI response contract.
3. Define roadmap configuration validation and defaults.
4. Extend the Mongoose report schema.
5. Update controller input handling and deterministic score calculation.
6. Add schema and service tests using mocked Gemini responses.

### Milestone 2 — Analysis interface

1. Replace report navigation with the finalized sections.
2. Add center-panel analysis components.
3. Extend the right panel with category scores and preparation progress.
4. Preserve owned report retrieval and PDF authorization.
5. Add responsive behavior and accessibility checks.

### Milestone 3 — Roadmap and exports

1. Add duration, daily-hours, and strategy controls.
2. Validate roadmap length and workload.
3. Add task completion persistence without changing match score.
4. Implement Ideal Resume and Complete Analysis Report exports.
5. Add export authorization and regression tests.

### Required testing

- Zod response validation tests
- Deterministic scoring tests
- Roadmap bounds/default tests
- Strategy-specific prompt/contract tests
- Zero-to-Hero prerequisite-order tests
- Report persistence and retrieval tests
- Frontend section rendering tests
- Responsive layout verification
- PDF export tests with Gemini and Puppeteer mocked
- Ownership and unauthenticated access tests
- Regression coverage for the existing PDF authorization fix

## 10. Known limitations and security considerations

- PDF text extraction may be weak for scanned/image-only resumes because OCR is not currently implemented.
- AI output is untrusted input and must remain schema-validated before storage or rendering.
- AI-generated HTML for resumes must be constrained or sanitized before Puppeteer rendering.
- Source resumes, self-descriptions, and job descriptions contain personal data and should have a documented retention/deletion policy.
- The PDF endpoint must continue querying by both report ID and authenticated user ID.
- Authentication cookies should eventually receive explicit production-safe options such as `httpOnly`, `secure` in production, and an intentional `sameSite` policy.
- Input length, malformed IDs, and invalid roadmap configuration require server-side validation.
- Gemini calls need rate limits, timeout handling, and cost controls before production use.
- Category weights, score semantics, retention policy, and export format are still product decisions unless explicitly approved.

