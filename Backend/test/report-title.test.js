const test = require("node:test")
const assert = require("node:assert/strict")
const { extractExplicitJobTitle, formatFallbackDate, generateReportTitle } = require("../src/services/report-title.service")

test("extracts explicit title labels case-insensitively", () => {
    assert.equal(extractExplicitJobTitle("Job Title: Senior Frontend Developer"), "Senior Frontend Developer")
    assert.equal(extractExplicitJobTitle("POSITION: Software Engineer"), "Software Engineer")
    assert.equal(extractExplicitJobTitle("Designation: Backend Developer"), "Backend Developer")
})

test("supports a title on the immediately following line", () => {
    assert.equal(extractExplicitJobTitle("Designation:\n  Backend Developer  "), "Backend Developer")
})

test("uses the first valid explicit label in document order", () => {
    assert.equal(extractExplicitJobTitle("Position: First Role\nJob Title: Second Role"), "First Role")
})

test("does not infer titles from generic headings or responsibilities", () => {
    assert.equal(extractExplicitJobTitle("About the Role\nBuild software as a Senior Engineer"), null)
    assert.equal(extractExplicitJobTitle("Requirements: Frontend Developer experience"), null)
})

test("rejects empty labels followed by explicit labels or section headings", () => {
    assert.equal(extractExplicitJobTitle("Job Title:\nResponsibilities:\nBuild scalable applications."), null)
    assert.equal(extractExplicitJobTitle("Job Title:\nPosition: Senior Engineer"), "Senior Engineer")
    assert.equal(extractExplicitJobTitle("Job Title:\nWhat You'll Do:"), null)
})

test("rejects generic same-line candidates while accepting later valid titles", () => {
    assert.equal(extractExplicitJobTitle("Position: Benefits:\nJob Title: Platform Engineer"), "Platform Engineer")
    assert.equal(extractExplicitJobTitle("Job Title: Senior Frontend Developer:"), "Senior Frontend Developer")
})

test("handles CRLF input and rejects overlong titles", () => {
    assert.equal(extractExplicitJobTitle("JOB TITLE:\r\nBackend Developer\r\nSkills:"), "Backend Developer")
    assert.equal(extractExplicitJobTitle(`Job Title: ${"A".repeat(161)}`), null)
})

test("formats fallback dates in UTC and generates a fallback title", () => {
    const date = new Date("2026-11-16T23:30:00.000Z")
    assert.equal(formatFallbackDate(date), "16 Nov 2026")
    assert.equal(generateReportTitle({ jobDescription: "No explicit title", now: date }), "Resume Analysis — 16 Nov 2026")
    assert.equal(generateReportTitle({ jobDescription: "", now: date }), "Resume Analysis — 16 Nov 2026")
})

test("preserves a supported non-empty caller-supplied title", () => {
    assert.equal(generateReportTitle({ jobDescription: "Job Title: Engineer", requestedTitle: "  Custom Role  " }), "Custom Role")
    assert.equal(generateReportTitle({ jobDescription: "Job Title: Engineer", requestedTitle: "   " }), "Engineer")
})
