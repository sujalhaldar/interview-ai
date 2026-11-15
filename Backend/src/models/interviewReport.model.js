const mongoose = require('mongoose');


const technicalQuestionSchema = new mongoose.Schema({
    question: {
        type: String,
        required: [ true, "Technical question is required" ]
    },
    intention: {
        type: String,
        required: [ true, "Intention is required" ]
    },
    answer: {
        type: String,
        required: [ true, "Answer is required" ]
    }
}, {
    _id: false
})

const behavioralQuestionSchema = new mongoose.Schema({
    question: {
        type: String,
        required: [ true, "Technical question is required" ]
    },
    intention: {
        type: String,
        required: [ true, "Intention is required" ]
    },
    answer: {
        type: String,
        required: [ true, "Answer is required" ]
    }
}, {
    _id: false
})

const skillGapSchema = new mongoose.Schema({
    skill: {
        type: String,
        required: [ true, "Skill is required" ]
    },
    severity: {
        type: String,
        enum: [ "low", "medium", "high" ],
        required: [ true, "Severity is required" ]
    }
}, {
    _id: false
})

const preparationPlanSchema = new mongoose.Schema({
    day: {
        type: Number,
        required: [ true, "Day is required" ]
    },
    focus: {
        type: String,
        required: [ true, "Focus is required" ]
    },
    tasks: [ {
        type: String,
        required: [ true, "Task is required" ]
    } ]
})

const evidenceItemSchema = new mongoose.Schema({
    title: { type: String, required: true },
    evidence: [ String ],
    explanation: String,
    recommendation: String,
    relatedRequirement: String
}, { _id: false })

const categoryAssessmentSchema = new mongoose.Schema({
    category: { type: String, enum: [ "coreTechnicalSkills", "relevantExperience", "toolsAndTechnologies", "domainResponsibilityAlignment", "educationAndCertifications" ], required: true },
    score: { type: Number, min: 0, max: 100, required: true },
    evidence: [ String ],
    explanation: { type: String, required: true }
}, { _id: false })

const eligibilityMetricSchema = new mongoose.Schema({
    status: { type: String, enum: [ "Met", "Not Met", "Unknown" ], required: true },
    requirement: String,
    evidence: [ String ],
    explanation: { type: String, required: true }
}, { _id: false })

const resumeEvidenceSchema = new mongoose.Schema({}, { _id: false, strict: false })
const confirmedSkillSchema = new mongoose.Schema({
    originalText: { type: String, required: true },
    normalizedName: { type: String, required: true },
    sourceType: { type: String, enum: [ "userConfirmed" ], required: true },
    confidence: { type: String, enum: [ "userConfirmed" ], required: true }
}, { _id: false })
const requirementAnalysisItemSchema = new mongoose.Schema({
    originalText: String,
    normalizedName: String,
    category: String,
    requirementType: { type: String, enum: [ "required", "preferred", "unspecified" ] },
    sourceEvidence: String,
    scoringCategory: String,
    status: { type: String, enum: [ "matched", "partial", "missing", "needsVerification" ] },
    matchedEvidence: [ resumeEvidenceSchema ],
    explanation: String
}, { _id: false, strict: false })

const categoryScoreSchema = new mongoose.Schema({
    category: String,
    score: { type: Number, min: 0, max: 100, default: null },
    weight: { type: Number, min: 0 },
    applicableRequirementCount: { type: Number, min: 0 }
}, { _id: false })

const requirementAnalysisSchema = new mongoose.Schema({
    requirements: [ requirementAnalysisItemSchema ],
    matchedRequirements: [ requirementAnalysisItemSchema ],
    partialRequirements: [ requirementAnalysisItemSchema ],
    missingRequirements: [ requirementAnalysisItemSchema ],
    needsVerificationRequirements: [ requirementAnalysisItemSchema ],
    unscoredRequirements: [ requirementAnalysisItemSchema ]
}, { _id: false })

const interviewReportSchema = new mongoose.Schema({
    analysisVersion: { type: String, enum: [ "1.0", "2.0" ] },
    jobDescription: {
        type: String,
        required: [ true, "Job description is required" ]
    },
    resume: {
        type: String,
    },
    selfDescription: {
        type: String,
    },
    matchScore: {
        type: Number,
        min: 0,
        max: 100,
    },
    overallSummary: String,
    categoryAssessments: [ categoryAssessmentSchema ],
    categoryScores: { type: [ categoryScoreSchema ], default: undefined },
    requirementAnalysis: { type: requirementAnalysisSchema, default: undefined },
    eligibility: {
        minimumExperience: eligibilityMetricSchema,
        requiredCertifications: eligibilityMetricSchema,
        education: eligibilityMetricSchema,
        otherMandatoryRequirements: [ eligibilityMetricSchema ]
    },
    skillAssessments: [ mongoose.Schema.Types.Mixed ],
    strengths: [ mongoose.Schema.Types.Mixed ],
    areasOfImprovement: [ mongoose.Schema.Types.Mixed ],
    resumeGaps: [ mongoose.Schema.Types.Mixed ],
    experienceAlignment: mongoose.Schema.Types.Mixed,
    educationCertificationAnalysis: mongoose.Schema.Types.Mixed,
    toneStyleAnalysis: {
        tone: String,
        writingFindings: [ String ],
        formattingFindings: [ String ],
        atsRisks: [ String ],
        recommendations: [ String ]
    },
    technicalQuestions: [ technicalQuestionSchema ],
    behavioralQuestions: [ behavioralQuestionSchema ],
    resumeQualityAnalysis: String,
    skillGaps: [ mongoose.Schema.Types.Mixed ],
    confirmedSkills: { type: [ confirmedSkillSchema ], default: [] },
    analysisRevision: { type: Number, min: 0, default: 0 },
    preparationPlan: [ preparationPlanSchema ],
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users"
    },
    title: {
        type: String,
        required: [ true, "Job title is required" ]
    }
}, {
    timestamps: true
})

// Preserve legacy nested path metadata while validating the canonical V1/V2 representations below.
const legacyPath = new mongoose.Schema({ value: String }, { _id: false }).path("value")
for (const path of ["experienceAlignment.status", "experienceAlignment.alignedEvidence", "experienceAlignment.gaps", "experienceAlignment.explanation", "educationCertificationAnalysis.educationFindings", "educationCertificationAnalysis.certificationFindings", "educationCertificationAnalysis.explanation"]) interviewReportSchema.paths[path] = legacyPath

interviewReportSchema.path("experienceAlignment").validate(function (value) {
    if (this.analysisVersion === "2.0") return typeof value === "string"
    return value === undefined || (value && typeof value === "object" && !Array.isArray(value))
}, "experienceAlignment has an invalid representation for this analysis version")
interviewReportSchema.path("educationCertificationAnalysis").validate(function (value) {
    if (this.analysisVersion === "2.0") return typeof value === "string"
    return value === undefined || (value && typeof value === "object" && !Array.isArray(value))
}, "educationCertificationAnalysis has an invalid representation for this analysis version")


const interviewReportModel = mongoose.model("InterviewReport", interviewReportSchema);

module.exports = interviewReportModel;
