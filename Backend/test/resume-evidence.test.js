const { test } = require("node:test")
const assert = require("node:assert/strict")
const { extractResumeEvidence } = require("../src/services/resume-evidence.service")

function skill(report, name) { return report.skills.find(item => item.normalizedValue === name) }

test("extracts normalized skills from a skills section", () => {
    const report = extractResumeEvidence("Technical Skills\nJavaScript, React.js, NodeJS, Postgres, AWS")
    assert.equal(skill(report, "JavaScript").category, "programmingLanguage")
    assert.equal(skill(report, "React").originalText, "React.js")
    assert.equal(skill(report, "Node.js").originalText, "NodeJS")
    assert.equal(skill(report, "PostgreSQL").originalText, "Postgres")
    assert.equal(skill(report, "AWS").evidence[0].sourceType, "skillsSection")
})

test("keeps project, professional, and summary evidence distinct", () => {
    const report = extractResumeEvidence(`Summary\nBuilt solutions with Docker.\nProjects\nPortfolio Dashboard\n- Docker deployment\nExperience\nSoftware Engineer | Acme\nJan 2022 - Dec 2023\n- Improved delivery using Docker.`)
    const docker = skill(report, "Docker")
    assert.deepEqual(new Set(docker.evidence.map(item => item.sourceType)), new Set(["summary", "project", "professionalExperience"]))
    assert.equal(report.professionalExperience[0].company.normalizedValue, "Acme")
})

test("preserves similar technology boundaries and unknown explicit skills", () => {
    const report = extractResumeEvidence("Skills\nJava, JavaScript, React Native, SvelteKit")
    assert.ok(skill(report, "Java"))
    assert.ok(skill(report, "JavaScript"))
    assert.ok(skill(report, "React Native"))
    assert.equal(skill(report, "SvelteKit").category, "other")
})

test("does not infer duration from incomplete employment dates", () => {
    const report = extractResumeEvidence("Experience\nFrontend Developer | Acme\n2021 -\n- Built React interfaces")
    assert.equal(report.professionalExperience[0].dates.status, "unknown")
    assert.equal(report.professionalExperience[0].duration.status, "unknown")
})

test("extracts explicit education and certification evidence", () => {
    const report = extractResumeEvidence("Education\nBachelor's in Computer Science, State University, 2020\nCertifications\nAWS Certified Developer")
    assert.equal(report.education[0].degree.category, "degree")
    assert.equal(report.education[0].institution.normalizedValue, "State University")
    assert.equal(report.education[0].graduationYear.normalizedValue, "2020")
    assert.equal(report.certifications[0].name.originalText, "AWS Certified Developer")
})

test("preserves an in-progress degree and expected graduation evidence", () => {
    const report = extractResumeEvidence("Education\nKIIT University\nB.Tech in Computer Science and Engineering (Full-time)\nExpected 2027")
    assert.equal(report.education[0].completionStatus, "inProgress")
    assert.match(report.education[0].fieldOfStudy.normalizedValue, /Computer Science/)
    assert.equal(report.education[1].graduationYear.normalizedValue, "2027")
})

test("handles empty and malformed resumes without fabricating evidence", () => {
    assert.deepEqual(extractResumeEvidence().skills, [])
    const report = extractResumeEvidence("A vague paragraph with no structured resume sections.")
    assert.deepEqual(report.professionalExperience, [])
    assert.deepEqual(report.education, [])
    assert.deepEqual(report.certifications, [])
})

test("is deterministic for identical input", () => {
    const resume = "Skills\nTypeScript, MongoDB\nProjects\nAPI\n- TypeScript service"
    assert.deepEqual(extractResumeEvidence(resume), extractResumeEvidence(resume))
})
