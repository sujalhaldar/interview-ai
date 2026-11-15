const { test } = require("node:test")
const assert = require("node:assert/strict")
const { mapResumeAnalysisReport } = require("../src/services/resume-analysis-report-mapper.service")

const qualitative = { overallSummary: "Good fit", experienceAlignment: "Relevant experience", strengths: ["React experience"], areasOfImprovement: ["Clarify outcomes"], educationCertificationAnalysis: "Degree is present", resumeQualityAnalysis: "Readable" }
const evidence = [{ originalText: "React.js", normalizedValue: "React", category: "frameworkOrLibrary", sourceType: "skillsSection", sourceSection: "skills", evidenceText: "React.js", status: "explicit", confidence: "high" }]
const requirement = (name, category, status, scoringCategory = "requiredTechnicalSkills") => ({ originalText: name, normalizedName: name, category, requirementType: "required", sourceEvidence: `Required ${name}`, scoringCategory, status, matchedEvidence: evidence, explanation: `${status} evidence` })
const scoring = requirements => ({ overallMatchScore: 72, categoryScores: [{ category: "requiredTechnicalSkills", score: 72, weight: 40, applicableRequirementCount: requirements.length }], requirements, matchedRequirements: requirements.filter(item => item.status === "matched"), partialRequirements: requirements.filter(item => item.status === "partial"), missingRequirements: requirements.filter(item => item.status === "missing"), needsVerificationRequirements: requirements.filter(item => item.status === "needsVerification") })

test("maps complete scoring and qualitative contracts", () => {
    const result = mapResumeAnalysisReport({ scoringResult: scoring([requirement("React", "frameworkOrLibrary", "matched")]), qualitativeAnalysis: qualitative })
    assert.equal(result.analysisVersion, "2.0")
    assert.equal(result.matchScore, 72)
    assert.equal(result.overallSummary, "Good fit")
    assert.deepEqual(result.strengths, qualitative.strengths)
    assert.deepEqual(result.areasOfImprovement, qualitative.areasOfImprovement)
    assert.equal(result.eligibility, null)
    assert.equal(result.experienceAlignment, qualitative.experienceAlignment)
    assert.equal(result.educationCertificationAnalysis, qualitative.educationCertificationAnalysis)
    assert.equal(result.resumeQualityAnalysis, qualitative.resumeQualityAnalysis)
})

test("preserves null scores, category scores, statuses, and evidence", () => {
    const requirements = [requirement("React", "frameworkOrLibrary", "matched"), requirement("Docker", "toolOrPlatform", "partial", "toolsAndTechnologies"), requirement("AWS", "toolOrPlatform", "missing", "toolsAndTechnologies"), requirement("Bachelor", "education", "needsVerification", "educationAndCertifications")]
    const result = mapResumeAnalysisReport({ scoringResult: { ...scoring(requirements), overallMatchScore: null }, qualitativeAnalysis: qualitative })
    assert.equal(result.matchScore, null)
    assert.equal(result.requirementAnalysis.requirements.length, 4)
    assert.equal(result.requirementAnalysis.needsVerificationRequirements[0].status, "needsVerification")
    assert.deepEqual(result.requirementAnalysis.requirements[0].matchedEvidence, evidence)
    assert.equal(result.categoryScores[0].applicableRequirementCount, 4)
})

test("keeps unscored requirements visible and derives gaps only from records", () => {
    const unknown = requirement("Security clearance", "other", "missing", null)
    const partial = requirement("Docker", "toolOrPlatform", "partial", "toolsAndTechnologies")
    const result = mapResumeAnalysisReport({ scoringResult: scoring([unknown, partial]), qualitativeAnalysis: qualitative })
    assert.equal(result.requirementAnalysis.unscoredRequirements[0].normalizedName, "Security clearance")
    assert.deepEqual(result.resumeGaps.map(item => item.title), ["Docker", "Security clearance"])
    assert.equal(result.skillGaps.some(item => item.skill === "Docker"), true)
})

test("does not mutate input and is deterministic", () => {
    const scoringResult = scoring([requirement("React", "frameworkOrLibrary", "matched")])
    const snapshot = JSON.stringify(scoringResult)
    const first = mapResumeAnalysisReport({ scoringResult, qualitativeAnalysis: qualitative })
    const second = mapResumeAnalysisReport({ scoringResult, qualitativeAnalysis: qualitative })
    assert.deepEqual(first, second)
    assert.equal(JSON.stringify(scoringResult), snapshot)
})

test("rejects invalid scores, statuses, qualitative fields, and inconsistent requirements", () => {
    const base = scoring([requirement("React", "frameworkOrLibrary", "matched")])
    assert.throws(() => mapResumeAnalysisReport({ scoringResult: { ...base, overallMatchScore: 101 }, qualitativeAnalysis: qualitative }), /overallMatchScore/)
    const invalidStatus = { ...base, requirements: [{ ...base.requirements[0], status: "invalid" }] }
    assert.throws(() => mapResumeAnalysisReport({ scoringResult: invalidStatus, qualitativeAnalysis: qualitative }), /Invalid requirement status/)
    assert.throws(() => mapResumeAnalysisReport({ scoringResult: base, qualitativeAnalysis: { ...qualitative, strengths: "bad" } }), /strengths/)
    const missingGroup = { ...base, needsVerificationRequirements: undefined }
    assert.throws(() => mapResumeAnalysisReport({ scoringResult: missingGroup, qualitativeAnalysis: qualitative }), /needsVerification/)
})

test("rejects missing qualitative contract fields", () => {
    const base = scoring([requirement("React", "frameworkOrLibrary", "matched")])
    for (const field of ["overallSummary", "experienceAlignment", "educationCertificationAnalysis", "resumeQualityAnalysis", "strengths", "areasOfImprovement"]) {
        const incomplete = { ...qualitative }
        delete incomplete[field]
        assert.throws(() => mapResumeAnalysisReport({ scoringResult: base, qualitativeAnalysis: incomplete }), new RegExp(field))
    }
})
