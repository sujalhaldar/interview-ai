const { test } = require("node:test")
const assert = require("node:assert/strict")
const interviewReportModel = require("../src/models/interviewReport.model")

const evidence = { originalText: "React.js", normalizedValue: "React", category: "frameworkOrLibrary", sourceType: "skillsSection", sourceSection: "skills", evidenceText: "React.js", status: "explicit", confidence: "high" }
const requirement = { originalText: "React", normalizedName: "React", category: "frameworkOrLibrary", requirementType: "required", sourceEvidence: "React required", scoringCategory: "requiredTechnicalSkills", status: "matched", matchedEvidence: [ evidence ], explanation: "Matched" }
const v2 = {
    analysisVersion: "2.0", jobDescription: "React role", title: "Engineer", matchScore: null, overallSummary: "Summary",
    categoryScores: [{ category: "requiredTechnicalSkills", score: null, weight: 40, applicableRequirementCount: 0 }],
    requirementAnalysis: { requirements: [ requirement ], matchedRequirements: [ requirement ], partialRequirements: [], missingRequirements: [], needsVerificationRequirements: [], unscoredRequirements: [] },
    strengths: ["Strong React background"], areasOfImprovement: ["Clarify outcomes"], experienceAlignment: "Aligned", educationCertificationAnalysis: "Degree noted", resumeQualityAnalysis: "Readable",
    resumeGaps: [], skillAssessments: [{ skill: "React", status: "matched", evidence: [evidence], explanation: "Matched" }], skillGaps: [], eligibility: null
}

test("validates the complete V2 report shape without a database connection", () => {
    const document = new interviewReportModel(v2)
    assert.equal(document.validateSync(), undefined)
    assert.equal(document.analysisVersion, "2.0")
    assert.equal(document.matchScore, null)
    assert.equal(document.requirementAnalysis.requirements[0].matchedEvidence[0].normalizedValue, "React")
})

test("preserves category scores, classifications, evidence, strings, and null eligibility", () => {
    const document = new interviewReportModel(v2)
    assert.equal(document.categoryScores[0].weight, 40)
    assert.equal(document.requirementAnalysis.matchedRequirements[0].status, "matched")
    assert.equal(document.strengths[0], "Strong React background")
    assert.ok(document.eligibility)
})

test("accepts historical reports and leaves missing V2 fields absent", () => {
    const document = new interviewReportModel({ analysisVersion: "1.0", jobDescription: "Legacy role", title: "Engineer", matchScore: 68, strengths: [{ title: "React", evidence: ["React"], explanation: "Strong" }], technicalQuestions: [{ question: "Q", intention: "I", answer: "A" }] })
    assert.equal(document.validateSync(), undefined)
    assert.equal(document.matchScore, 68)
    assert.equal(document.categoryScores, undefined)
    assert.equal(document.requirementAnalysis, undefined)
    assert.equal(document.technicalQuestions[0].question, "Q")
})

test("rejects invalid V2 versions, score ranges, and requirement statuses", () => {
    const invalidVersion = new interviewReportModel({ ...v2, analysisVersion: "3.0" })
    assert.equal(invalidVersion.validateSync().errors.analysisVersion.kind, "enum")
    const invalidScore = new interviewReportModel({ ...v2, matchScore: 101 })
    assert.equal(invalidScore.validateSync().errors.matchScore.kind, "max")
    const invalidStatus = new interviewReportModel({ ...v2, requirementAnalysis: { ...v2.requirementAnalysis, requirements: [{ ...requirement, status: "invalid" }] } })
    assert.equal(invalidStatus.validateSync().errors["requirementAnalysis.requirements.0.status"].kind, "enum")
})

test("enforces version-aware alignment field representations", () => {
    const legacy = new interviewReportModel({ analysisVersion: "1.0", jobDescription: "Legacy", title: "Engineer", experienceAlignment: { status: "Aligned", alignedEvidence: [], gaps: [], explanation: "Legacy" }, educationCertificationAnalysis: { educationFindings: [], certificationFindings: [], explanation: "Legacy" } })
    assert.equal(legacy.validateSync(), undefined)
    const v2 = new interviewReportModel({ ...v2Base(), experienceAlignment: "Aligned text", educationCertificationAnalysis: "Education text" })
    assert.equal(v2.validateSync(), undefined)
    const invalidV2 = new interviewReportModel({ ...v2Base(), experienceAlignment: { status: "Aligned" } })
    assert.ok(invalidV2.validateSync().errors.experienceAlignment)
    const invalidLegacy = new interviewReportModel({ analysisVersion: "1.0", jobDescription: "Legacy", title: "Engineer", experienceAlignment: "wrong" })
    assert.ok(invalidLegacy.validateSync().errors.experienceAlignment)
})

function v2Base() {
    return { analysisVersion: "2.0", jobDescription: "V2", title: "Engineer", matchScore: null, experienceAlignment: "", educationCertificationAnalysis: "", strengths: [], areasOfImprovement: [] }
}
