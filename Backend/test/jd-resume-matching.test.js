const { test } = require("node:test")
const assert = require("node:assert/strict")
const { matchJdRequirements } = require("../src/services/jd-resume-matching.service")

const ev = (value, sourceType, category = "toolOrPlatform", text = value) => ({ originalText: value, normalizedValue: value, category, sourceType, sourceSection: sourceType, evidenceText: text, status: "explicit", confidence: "high" })
const skill = (name, evidence) => ({ originalText: name, normalizedValue: name, category: evidence[0].category, evidence })
const req = (name, category, type = "required", originalText = name) => ({ originalText, normalizedName: name, category, requirementType: type, sourceEvidence: originalText })

test("matches exact and alias-normalized technology evidence", () => {
    const result = matchJdRequirements({ requirements: [req("React", "frameworkOrLibrary")] }, { skills: [skill("React", [ev("React.js", "skillsSection", "frameworkOrLibrary")])] })
    assert.equal(result.requirements[0].status, "matched")
})

test("keeps project, skills, summary, and professional evidence distinct", () => {
    const resume = { skills: [skill("Docker", [ev("Docker", "skillsSection"), ev("Docker", "project"), ev("Docker", "summary"), ev("Docker", "professionalExperience")])] }
    const result = matchJdRequirements({ requirements: [req("Docker", "toolOrPlatform")] }, resume)
    assert.equal(result.requirements[0].matchedEvidence.length, 4)
    assert.deepEqual(new Set(result.requirements[0].matchedEvidence.map(item => item.sourceType)), new Set(["skillsSection", "project", "summary", "professionalExperience"]))
})

test("returns missing for absent and distinct technologies", () => {
    const result = matchJdRequirements({ requirements: [req("JavaScript", "programmingLanguage"), req("React Native", "frameworkOrLibrary"), req("SvelteKit", "other")] }, { skills: [skill("Java", [ev("Java", "skillsSection", "programmingLanguage")])] })
    assert.deepEqual(result.requirements.map(item => item.status), ["missing", "missing", "missing"])
})

test("classifies project-only professional duration evidence as partial", () => {
    const result = matchJdRequirements({ requirements: [req("Docker", "experience", "required", "2+ years of Docker experience")] }, { skills: [skill("Docker", [ev("Docker", "project", "toolOrPlatform")])] })
    assert.equal(result.requirements[0].status, "partial")
})

test("accepts explicit self-reported duration with explanation", () => {
    const result = matchJdRequirements({ requirements: [req("Java", "experience", "required", "2+ years of Java experience")] }, { professionalExperience: [{ technologies: [ev("Java", "professionalExperience", "programmingLanguage")], responsibilities: [ev("2 years of Java development", "professionalExperience", "responsibility")] }] })
    assert.equal(result.requirements[0].status, "matched")
    assert.match(result.requirements[0].explanation, /self-reported/i)
})

test("uses explicit dates conservatively and does not infer missing duration", () => {
    const base = { professionalExperience: [{ technologies: [ev("Java", "professionalExperience", "programmingLanguage")], dates: { start: "2020", end: "2023", status: "explicit" }, responsibilities: [], achievements: [] }] }
    assert.equal(matchJdRequirements({ requirements: [req("Java", "experience", "required", "2+ years of Java experience")] }, base).requirements[0].status, "matched")
    const missingDates = { professionalExperience: [{ technologies: [ev("Java", "professionalExperience", "programmingLanguage")], dates: { status: "unknown" }, responsibilities: [], achievements: [] }] }
    assert.equal(matchJdRequirements({ requirements: [req("Java", "experience", "required", "2+ years of Java experience")] }, missingDates).requirements[0].status, "needsVerification")
})

test("matches education and certification evidence", () => {
    const resume = { education: [{ degree: ev("Bachelor's degree in Computer Science", "education", "degree") }], certifications: [{ name: ev("AWS Certified Developer", "certification", "certification") }] }
    const result = matchJdRequirements({ requirements: [req("Bachelor's degree in Computer Science", "education"), req("AWS Certified Developer", "certification")] }, resume)
    assert.deepEqual(result.requirements.map(item => item.status), ["matched", "matched"])
})

test("classifies a relevant in-progress degree as partial instead of missing", () => {
    const resume = { education: [{ degree: ev("B.Tech in Computer Science and Engineering", "education", "degree"), fieldOfStudy: ev("Computer Science and Engineering", "education", "fieldOfStudy"), completionStatus: "inProgress" }], certifications: [] }
    const result = matchJdRequirements({ requirements: [req("Bachelor's degree in Computer Science", "education")] }, resume)
    assert.equal(result.requirements[0].status, "partial")
})

test("returns aggregate counts and is deterministic for empty input", () => {
    const result = matchJdRequirements({ requirements: [] }, {})
    assert.deepEqual(result.summary, { total: 0, matched: 0, partial: 0, missing: 0, needsVerification: 0 })
    assert.deepEqual(result, matchJdRequirements({ requirements: [] }, {}))
})
