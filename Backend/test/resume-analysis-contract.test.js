const { test } = require("node:test")
const assert = require("node:assert/strict")

process.env.GOOGLE_GENAI_API_KEY = "resume-analysis-test-key"

const {
    interviewReportSchema,
    analysisResponseSchemaForGemini,
    geminiResumeAnalysisSchema,
    geminiResumeAnalysisProviderSchema,
    CATEGORY_WEIGHTS,
    calculateOverallMatchScore
} = require("../src/services/ai.service")
const interviewReportModel = require("../src/models/interviewReport.model")

const categories = [
    [ "coreTechnicalSkills", 80 ],
    [ "relevantExperience", 70 ],
    [ "toolsAndTechnologies", 60 ],
    [ "domainResponsibilityAlignment", 50 ],
    [ "educationAndCertifications", 40 ]
]

function validAnalysis() {
    return {
        analysisVersion: "1.0",
        overallSummary: "Evidence-backed summary.",
        categoryAssessments: categories.map(([ category, score ]) => ({
            category,
            score,
            evidence: [ "Evidence from submitted materials." ],
            explanation: "Category explanation."
        })),
        eligibility: {
            minimumExperience: { status: "Unknown", evidence: [], explanation: "Insufficient evidence." },
            requiredCertifications: { status: "Unknown", evidence: [], explanation: "No explicit requirement evidence." },
            education: { status: "Met", evidence: [ "Degree listed." ], explanation: "Requirement is evidenced." },
            otherMandatoryRequirements: []
        },
        skillAssessments: [ {
            skill: "React",
            status: "Matched",
            importance: "Required",
            evidence: [ "React project listed." ],
            explanation: "Explicitly evidenced."
        } ],
        strengths: [ { title: "Frontend delivery", evidence: [ "Project evidence." ], explanation: "Relevant strength." } ],
        areasOfImprovement: [ { title: "Testing depth", evidence: [ "No testing evidence." ], recommendation: "Add testing examples." } ],
        resumeGaps: [ { title: "Missing metrics", evidence: [ "Bullets lack outcomes." ], relatedRequirement: "Impact", explanation: "Add measurable results." } ],
        experienceAlignment: { status: "Partially Aligned", alignedEvidence: [ "Relevant responsibilities." ], gaps: [ "Limited seniority evidence." ], explanation: "Partial match." },
        educationCertificationAnalysis: { educationFindings: [ "Degree listed." ], certificationFindings: [], explanation: "Reviewed explicit credentials." },
        toneStyleAnalysis: { tone: "Professional", writingFindings: [], formattingFindings: [], atsRisks: [], recommendations: [] },
        technicalQuestions: [],
        behavioralQuestions: [],
        skillGaps: [],
        title: "Frontend Engineer"
    }
}

test("validates the approved Resume Analysis response contract", () => {
    const result = interviewReportSchema.safeParse(validAnalysis())

    assert.equal(result.success, true)
    assert.equal(Object.hasOwn(validAnalysis(), "preparationPlan"), false)
})

test("validates the minimal qualitative Gemini contract", () => {
    const valid = {
        overallSummary: "The candidate shows relevant frontend experience.",
        experienceAlignment: "Experience aligns with the target responsibilities.",
        strengths: [ "React delivery" ],
        areasOfImprovement: [ "Add measurable outcomes" ],
        educationCertificationAnalysis: "No explicit certification requirement was evidenced.",
        resumeQualityAnalysis: "The resume is readable but could improve keyword placement."
    }

    assert.equal(geminiResumeAnalysisSchema.safeParse(valid).success, true)
    assert.equal(geminiResumeAnalysisSchema.safeParse({ ...valid, strengths: [ "" ] }).success, false)
    assert.equal(geminiResumeAnalysisSchema.safeParse({ ...valid, resumeQualityAnalysis: 42 }).success, false)
    assert.equal(geminiResumeAnalysisSchema.safeParse({ ...valid, areasOfImprovement: undefined }).success, false)
})

test("builds a minimal provider schema for the qualitative Gemini contract", () => {
    const schema = geminiResumeAnalysisProviderSchema()

    assert.deepEqual(Object.keys(schema.properties).sort(), [
        "areasOfImprovement",
        "educationCertificationAnalysis",
        "experienceAlignment",
        "overallSummary",
        "resumeQualityAnalysis",
        "strengths"
    ].sort())
    assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort())
    assert.equal(schema.properties.strengths.items.type, "string")
    assert.equal(schema.properties.areasOfImprovement.items.type, "string")
    assert.equal(schema.properties.strengths.maxItems, undefined)
    assert.equal(schema.properties.areasOfImprovement.maxItems, undefined)
    assert.equal(JSON.stringify(schema).includes("$ref"), false)
})

test("simplifies only skill-assessment array constraints for Gemini", () => {
    const providerSchema = analysisResponseSchemaForGemini()
    const skillSchema = providerSchema.properties.skillAssessments
    const evidenceSchema = skillSchema.items.properties.evidence

    assert.equal(skillSchema.maxItems, undefined)
    assert.equal(skillSchema.minItems, undefined)
    assert.equal(evidenceSchema.maxItems, undefined)
    assert.equal(evidenceSchema.minItems, undefined)
    assert.deepEqual(skillSchema.items.required, [ "skill", "status", "importance", "evidence", "explanation" ])
    assert.deepEqual(skillSchema.items.properties.status.enum, [ "Matched", "Partial", "Missing", "Needs Verification" ])
    assert.deepEqual(skillSchema.items.properties.importance.enum, [ "Critical", "Required", "Preferred", "Bonus" ])
})

test("rejects unsupported eligibility and skill statuses", () => {
    const invalid = validAnalysis()
    invalid.eligibility.education.status = "Missing"
    invalid.skillAssessments[0].status = "Unknown"

    assert.equal(interviewReportSchema.safeParse(invalid).success, false)
})

test("calculates the overall score deterministically from approved weights", () => {
    const score = calculateOverallMatchScore(validAnalysis().categoryAssessments)
    const expected = Math.round(
        80 * CATEGORY_WEIGHTS.coreTechnicalSkills +
        70 * CATEGORY_WEIGHTS.relevantExperience +
        60 * CATEGORY_WEIGHTS.toolsAndTechnologies +
        50 * CATEGORY_WEIGHTS.domainResponsibilityAlignment +
        40 * CATEGORY_WEIGHTS.educationAndCertifications
    )

    assert.equal(score, expected)
    assert.deepEqual(CATEGORY_WEIGHTS, {
        coreTechnicalSkills: 0.35,
        relevantExperience: 0.25,
        toolsAndTechnologies: 0.15,
        domainResponsibilityAlignment: 0.15,
        educationAndCertifications: 0.1
    })
})

test("requires every scoring category before calculating the score", () => {
    const incomplete = validAnalysis().categoryAssessments.slice(0, 4)

    assert.throws(() => calculateOverallMatchScore(incomplete), /missing a scoring category/)
})

test("rejects duplicate scoring categories", () => {
    const invalid = validAnalysis()
    invalid.categoryAssessments[4].category = "coreTechnicalSkills"

    assert.equal(interviewReportSchema.safeParse(invalid).success, false)
})

test("rejects a response missing a scoring category", () => {
    const invalid = validAnalysis()
    invalid.categoryAssessments[4].category = "coreTechnicalSkills"
    invalid.categoryAssessments[3].category = "toolsAndTechnologies"

    assert.equal(interviewReportSchema.safeParse(invalid).success, false)
})

test("persists the new analysis fields in the report schema", () => {
    const paths = interviewReportModel.schema.paths

    assert.ok(paths.analysisVersion)
    assert.ok(paths.overallSummary)
    assert.ok(paths.categoryAssessments)
    assert.ok(paths["eligibility.minimumExperience"])
    assert.ok(paths.skillAssessments)
    assert.ok(paths.strengths)
    assert.ok(paths.areasOfImprovement)
    assert.ok(paths.resumeGaps)
    assert.ok(paths["experienceAlignment.status"])
    assert.ok(paths["educationCertificationAnalysis.educationFindings"])
    assert.ok(paths["toneStyleAnalysis.atsRisks"])
    assert.ok(paths.preparationPlan)
})
