const STATUS_VALUES = new Set(["matched", "partial", "missing", "needsVerification"])
const TYPE_MULTIPLIERS = { required: 1, preferred: 0.5, unspecified: 0.25 }
const STATUS_VALUES_NUMERIC = { matched: 1, partial: 0.5, needsVerification: 0.25, missing: 0 }
const CATEGORY_WEIGHTS = {
    requiredTechnicalSkills: 40,
    relevantProfessionalExperience: 30,
    toolsAndTechnologies: 15,
    educationAndCertifications: 15
}

function assert(condition, message) { if (!condition) throw new TypeError(message) }

function scoringCategory(requirement) {
    if (!requirement || typeof requirement !== "object") throw new TypeError("Invalid requirement")
    if (requirement.category === "toolOrPlatform") return "toolsAndTechnologies"
    if (["experience"].includes(requirement.category)) return "relevantProfessionalExperience"
    if (["education", "certification"].includes(requirement.category)) return "educationAndCertifications"
    if (["programmingLanguage", "frameworkOrLibrary", "database"].includes(requirement.category)) return "requiredTechnicalSkills"
    if (requirement.category === "other") {
        const text = `${requirement.normalizedName || ""} ${requirement.originalText || ""}`.toLowerCase()
        if (/\b(years?|experience|employment|degree|education|certif)/i.test(text)) return "relevantProfessionalExperience"
        if (/\b(tool|platform|software|cloud|database|framework|language|technology|skill)/i.test(text)) return "requiredTechnicalSkills"
        return null
    }
    throw new TypeError(`Unsupported requirement category: ${requirement.category}`)
}

function validateQualitative(value) {
    assert(value && typeof value === "object", "qualitativeAnalysis must be an object")
    for (const field of ["overallSummary", "experienceAlignment", "educationCertificationAnalysis", "resumeQualityAnalysis"]) assert(typeof value[field] === "string", `qualitativeAnalysis.${field} must be a string`)
    for (const field of ["strengths", "areasOfImprovement"]) assert(Array.isArray(value[field]) && value[field].every(item => typeof item === "string"), `qualitativeAnalysis.${field} must be a string array`)
}

function validateInputs({ jdRequirements, resumeEvidence, matchingResult, qualitativeAnalysis }) {
    assert(jdRequirements && Array.isArray(jdRequirements.requirements), "jdRequirements.requirements must be an array")
    assert(resumeEvidence && typeof resumeEvidence === "object", "resumeEvidence must be an object")
    assert(matchingResult && Array.isArray(matchingResult.requirements), "matchingResult.requirements must be an array")
    assert(matchingResult.requirements.length === jdRequirements.requirements.length, "matchingResult must contain every JD requirement")
    validateQualitative(qualitativeAnalysis)
    const seen = new Set()
    for (let index = 0; index < jdRequirements.requirements.length; index += 1) {
        const jd = jdRequirements.requirements[index]
        const match = matchingResult.requirements[index]
        assert(jd && typeof jd.normalizedName === "string" && typeof jd.category === "string", "Malformed JD requirement")
        const key = `${jd.category}:${jd.normalizedName.toLowerCase()}`
        assert(!seen.has(key), "Duplicate JD requirements are not allowed")
        seen.add(key)
        assert(match && match.normalizedName === jd.normalizedName && match.category === jd.category, "Matching result does not align with JD requirements")
        assert(STATUS_VALUES.has(match.status), `Unsupported matching status: ${match.status}`)
        assert(["required", "preferred", "unspecified"].includes(match.requirementType), "Unsupported requirement type")
        assert(Array.isArray(match.matchedEvidence), "matchedEvidence must be an array")
        assert(typeof match.explanation === "string", "Matching explanation must be a string")
    }
}

function assembleResumeAnalysisReport(input) {
    validateInputs(input)
    const { jdRequirements, matchingResult, qualitativeAnalysis } = input
    const requirements = matchingResult.requirements.map((match, index) => {
        const source = jdRequirements.requirements[index]
        return { ...source, scoringCategory: scoringCategory(source), status: match.status, matchedEvidence: match.matchedEvidence, explanation: match.explanation }
    })
    const categoryScores = Object.entries(CATEGORY_WEIGHTS).map(([category, weight]) => {
        const applicable = requirements.filter(requirement => requirement.scoringCategory === category)
        if (!applicable.length) return { category, score: null, weight, applicableRequirementCount: 0 }
        let numerator = 0
        let denominator = 0
        for (const requirement of applicable) {
            const multiplier = TYPE_MULTIPLIERS[requirement.requirementType]
            numerator += STATUS_VALUES_NUMERIC[requirement.status] * multiplier
            denominator += multiplier
        }
        return { category, score: (numerator / denominator) * 100, weight, applicableRequirementCount: applicable.length }
    })
    const applicableCategories = categoryScores.filter(item => item.applicableRequirementCount > 0)
    const weightTotal = applicableCategories.reduce((total, item) => total + item.weight, 0)
    const overallMatchScore = applicableCategories.length ? Math.round(applicableCategories.reduce((total, item) => total + item.score * item.weight, 0) / weightTotal) : null
    const grouped = status => requirements.filter(requirement => requirement.status === status)
    return {
        overallMatchScore,
        categoryScores,
        requirements,
        matchedRequirements: grouped("matched"),
        partialRequirements: grouped("partial"),
        missingRequirements: grouped("missing"),
        needsVerificationRequirements: grouped("needsVerification"),
        qualitativeAnalysis
    }
}

module.exports = { assembleResumeAnalysisReport, CATEGORY_WEIGHTS, TYPE_MULTIPLIERS, STATUS_VALUES_NUMERIC }
