const { test } = require("node:test")
const assert = require("node:assert/strict")
const { assembleResumeAnalysisReport } = require("../src/services/resume-analysis-scoring.service")

const qualitative = { overallSummary: "Summary", experienceAlignment: "Aligned", strengths: ["Strong skills"], areasOfImprovement: ["More detail"], educationCertificationAnalysis: "Clear", resumeQualityAnalysis: "Readable" }
const req = (normalizedName, category, requirementType = "required", originalText = normalizedName) => ({ originalText, normalizedName, category, requirementType, sourceEvidence: originalText })
const match = (requirement, status, evidence = []) => ({ ...requirement, status, matchedEvidence: evidence, explanation: `${status} explanation` })
const input = requirements => ({ jdRequirements: { requirements }, resumeEvidence: {}, matchingResult: { requirements: requirements.map(item => match(item, "matched")) }, qualitativeAnalysis: qualitative })

test("calculates all-matched score and preserves qualitative fields", () => {
    const requirements = [req("JavaScript", "programmingLanguage"), req("Docker", "toolOrPlatform"), req("2 years", "experience", "required", "2 years experience")]
    const result = assembleResumeAnalysisReport(input(requirements))
    assert.equal(result.overallMatchScore, 100)
    assert.equal(result.matchedRequirements.length, 3)
    assert.deepEqual(result.qualitativeAnalysis, qualitative)
})

test("calculates status and priority weighting", () => {
    const requirements = [req("JavaScript", "programmingLanguage", "required"), req("TypeScript", "programmingLanguage", "preferred"), req("Python", "programmingLanguage", "unspecified")]
    const data = input(requirements)
    data.matchingResult.requirements = [match(requirements[0], "matched"), match(requirements[1], "partial"), match(requirements[2], "missing")]
    const result = assembleResumeAnalysisReport(data)
    assert.equal(result.categoryScores.find(item => item.category === "requiredTechnicalSkills").score, 71.42857142857143)
    assert.equal(result.overallMatchScore, 71)
})

test("assigns categories mutually exclusively and separates Docker experience", () => {
    const requirements = [req("Docker", "toolOrPlatform"), req("2 years of Docker experience", "experience", "required")]
    const data = input(requirements)
    data.matchingResult.requirements = requirements.map(item => match(item, "matched"))
    const result = assembleResumeAnalysisReport(data)
    assert.equal(result.requirements[0].scoringCategory, "toolsAndTechnologies")
    assert.equal(result.requirements[1].scoringCategory, "relevantProfessionalExperience")
})

test("groups partial, missing, and verification statuses", () => {
    const requirements = [req("JavaScript", "programmingLanguage"), req("React", "frameworkOrLibrary"), req("AWS", "toolOrPlatform"), req("Bachelor", "education")]
    const data = input(requirements)
    data.matchingResult.requirements = [match(requirements[0], "partial"), match(requirements[1], "missing"), match(requirements[2], "needsVerification"), match(requirements[3], "matched")]
    const result = assembleResumeAnalysisReport(data)
    assert.equal(result.partialRequirements.length, 1)
    assert.equal(result.missingRequirements.length, 1)
    assert.equal(result.needsVerificationRequirements.length, 1)
})

test("excludes empty categories and rounds only the final overall score", () => {
    const requirements = [req("JavaScript", "programmingLanguage"), req("Docker", "toolOrPlatform")]
    const data = input(requirements)
    data.matchingResult.requirements = [match(requirements[0], "matched"), match(requirements[1], "partial")]
    const result = assembleResumeAnalysisReport(data)
    assert.equal(result.categoryScores.find(item => item.category === "relevantProfessionalExperience").score, null)
    assert.equal(result.overallMatchScore, 86)
})

test("returns null for an empty JD", () => {
    const result = assembleResumeAnalysisReport({ jdRequirements: { requirements: [] }, resumeEvidence: {}, matchingResult: { requirements: [] }, qualitativeAnalysis: qualitative })
    assert.equal(result.overallMatchScore, null)
    assert.equal(result.requirements.length, 0)
})

test("preserves matching evidence and deterministic output", () => {
    const requirement = req("React", "frameworkOrLibrary")
    const evidence = [{ originalText: "React.js", normalizedValue: "React", category: "frameworkOrLibrary", sourceType: "project", sourceSection: "projects", evidenceText: "Built with React.js", status: "explicit", confidence: "high" }]
    const data = input([requirement])
    data.matchingResult.requirements = [match(requirement, "partial", evidence)]
    const first = assembleResumeAnalysisReport(data)
    const second = assembleResumeAnalysisReport(data)
    assert.deepEqual(first, second)
    assert.deepEqual(first.requirements[0].matchedEvidence, evidence)
})

test("rejects duplicate or inconsistent inputs", () => {
    const duplicate = req("React", "frameworkOrLibrary")
    assert.throws(() => assembleResumeAnalysisReport(input([duplicate, duplicate])), /Duplicate JD requirements/)
    const malformed = input([req("React", "frameworkOrLibrary")])
    malformed.matchingResult.requirements[0].status = "invalid"
    assert.throws(() => assembleResumeAnalysisReport(malformed), /Unsupported matching status/)
    const inconsistent = input([req("React", "frameworkOrLibrary")])
    inconsistent.matchingResult.requirements[0].normalizedName = "Vue"
    assert.throws(() => assembleResumeAnalysisReport(inconsistent), /does not align/)
})
