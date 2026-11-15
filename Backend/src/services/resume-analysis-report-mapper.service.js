const VALID_STATUSES = new Set(["matched", "partial", "missing", "needsVerification"])

function assert(condition, message) { if (!condition) throw new TypeError(message) }

function validateQualitative(value) {
    assert(value && typeof value === "object", "qualitativeAnalysis is required")
    for (const field of ["overallSummary", "experienceAlignment", "educationCertificationAnalysis", "resumeQualityAnalysis"]) assert(typeof value[field] === "string", `qualitativeAnalysis.${field} must be a string`)
    for (const field of ["strengths", "areasOfImprovement"]) assert(Array.isArray(value[field]) && value[field].every(item => typeof item === "string"), `qualitativeAnalysis.${field} must be a string array`)
}

function validateScoring(value) {
    assert(value && typeof value === "object", "scoringResult is required")
    assert(value.overallMatchScore === null || (Number.isInteger(value.overallMatchScore) && value.overallMatchScore >= 0 && value.overallMatchScore <= 100), "overallMatchScore must be null or an integer from 0 to 100")
    assert(Array.isArray(value.categoryScores), "categoryScores must be an array")
    for (const category of value.categoryScores) {
        assert(category && typeof category.category === "string", "Invalid category score")
        assert(category.score === null || (typeof category.score === "number" && category.score >= 0 && category.score <= 100), "Invalid category score value")
        assert(Number.isInteger(category.applicableRequirementCount) && category.applicableRequirementCount >= 0, "Invalid applicable requirement count")
        assert(typeof category.weight === "number" && category.weight >= 0, "Invalid category weight")
    }
    assert(Array.isArray(value.requirements), "requirements must be an array")
    const seen = new Set()
    for (const requirement of value.requirements) {
        assert(requirement && typeof requirement.originalText === "string" && typeof requirement.normalizedName === "string", "Invalid requirement")
        assert(typeof requirement.category === "string" && ["required", "preferred", "unspecified"].includes(requirement.requirementType), "Invalid requirement classification")
        assert(requirement.scoringCategory === null || typeof requirement.scoringCategory === "string", "Invalid scoring category")
        assert(VALID_STATUSES.has(requirement.status), "Invalid requirement status")
        assert(Array.isArray(requirement.matchedEvidence), "matchedEvidence must be an array")
        assert(typeof requirement.explanation === "string", "Requirement explanation must be a string")
        const key = `${requirement.category}:${requirement.normalizedName.toLowerCase()}`
        assert(!seen.has(key), "Duplicate requirements are not allowed")
        seen.add(key)
    }
    for (const status of VALID_STATUSES) assert(Array.isArray(value[`${status === "needsVerification" ? "needsVerification" : status}Requirements`]), `Missing ${status} requirements`)
}

function requirementGroups(requirements, status) { return requirements.filter(item => item.status === status) }

function mapGap(requirement) {
    return {
        title: requirement.normalizedName,
        relatedRequirement: requirement.originalText,
        evidence: requirement.matchedEvidence,
        status: requirement.status,
        explanation: requirement.explanation
    }
}

function mapSkillGap(requirement) {
    return {
        skill: requirement.normalizedName,
        status: requirement.status,
        severity: requirement.requirementType === "required" ? "high" : "medium",
        evidence: requirement.matchedEvidence,
        explanation: requirement.explanation
    }
}

function mapResumeAnalysisReport({ scoringResult, qualitativeAnalysis }) {
    validateScoring(scoringResult)
    validateQualitative(qualitativeAnalysis)
    const requirements = scoringResult.requirements.map(item => ({ ...item, matchedEvidence: item.matchedEvidence.map(evidence => ({ ...evidence })) }))
    const unscoredRequirements = requirements.filter(item => item.scoringCategory === null)
    const partialRequirements = requirementGroups(requirements, "partial")
    const missingRequirements = requirementGroups(requirements, "missing")
    const needsVerificationRequirements = requirementGroups(requirements, "needsVerification")
    return {
        analysisVersion: "2.0",
        matchScore: scoringResult.overallMatchScore,
        overallSummary: qualitativeAnalysis.overallSummary,
        categoryScores: scoringResult.categoryScores.map(item => ({ ...item })),
        requirementAnalysis: {
            requirements,
            matchedRequirements: requirementGroups(requirements, "matched"),
            partialRequirements,
            missingRequirements,
            needsVerificationRequirements,
            unscoredRequirements
        },
        strengths: [...qualitativeAnalysis.strengths],
        areasOfImprovement: [...qualitativeAnalysis.areasOfImprovement],
        experienceAlignment: qualitativeAnalysis.experienceAlignment,
        educationCertificationAnalysis: qualitativeAnalysis.educationCertificationAnalysis,
        resumeQualityAnalysis: qualitativeAnalysis.resumeQualityAnalysis,
        resumeGaps: [...partialRequirements, ...missingRequirements].map(mapGap),
        skillAssessments: requirements.filter(item => ["programmingLanguage", "frameworkOrLibrary", "toolOrPlatform", "database", "other"].includes(item.category)).map(item => ({ skill: item.normalizedName, status: item.status, evidence: item.matchedEvidence, explanation: item.explanation })),
        skillGaps: [...partialRequirements, ...missingRequirements, ...needsVerificationRequirements].filter(item => ["programmingLanguage", "frameworkOrLibrary", "toolOrPlatform", "database", "other"].includes(item.category)).map(mapSkillGap),
        eligibility: null
    }
}

module.exports = { mapResumeAnalysisReport }
