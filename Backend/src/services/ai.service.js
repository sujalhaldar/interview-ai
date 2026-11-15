const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const puppeteer = require("puppeteer")

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY
})


const scoreCategorySchema = z.enum([
    "coreTechnicalSkills",
    "relevantExperience",
    "toolsAndTechnologies",
    "domainResponsibilityAlignment",
    "educationAndCertifications"
])
const eligibilityStatusSchema = z.enum([ "Met", "Not Met", "Unknown" ])
const skillStatusSchema = z.enum([ "Matched", "Partial", "Missing", "Needs Verification" ])
const importanceSchema = z.enum([ "Critical", "Required", "Preferred", "Bonus" ])
const boundedText = (max) => z.string().trim().min(1).max(max)
const evidenceSchema = z.array(boundedText(500)).max(5)
const CATEGORY_WEIGHTS = Object.freeze({
    coreTechnicalSkills: 0.35,
    relevantExperience: 0.25,
    toolsAndTechnologies: 0.15,
    domainResponsibilityAlignment: 0.15,
    educationAndCertifications: 0.10
})
const LEGACY_RESPONSE_FIELDS = [ "technicalQuestions", "behavioralQuestions", "skillGaps" ]

class ResumeAnalysisServiceError extends Error {
    constructor(message, { stage, cause, upstreamStatus, providerCode, zodIssues } = {}) {
        super(message, { cause })
        this.name = "ResumeAnalysisServiceError"
        this.stage = stage
        this.upstreamStatus = upstreamStatus
        this.providerCode = providerCode
        this.zodIssues = zodIssues
    }
}

function providerMetadata(error) {
    let providerError
    try {
        providerError = typeof error?.message === "string" ? JSON.parse(error.message)?.error : undefined
    } catch {
        providerError = undefined
    }

    const status = [ error?.status, error?.statusCode, error?.response?.status, error?.error?.code, providerError?.code ]
        .find(value => Number.isInteger(value))
    const providerCode = [ error?.error?.status, error?.response?.data?.error?.status, providerError?.status, error?.code ]
        .find(value => typeof value === "string" && value.length <= 80)

    return { upstreamStatus: status, providerCode }
}

function geminiResponseSchema(schema) {
    const unsupported = new Set([ "$schema", "additionalProperties", "minLength", "maxLength", "minimum", "maximum" ])

    function clean(value) {
        if (Array.isArray(value)) return value.map(clean)
        if (!value || typeof value !== "object") return value

        const result = {}
        for (const [ key, child ] of Object.entries(value)) {
            if (unsupported.has(key)) continue
            if (key === "const") {
                result.enum = [ child ]
                continue
            }
            result[key] = clean(child)
        }
        return result
    }

    return clean(schema)
}

function analysisResponseSchemaForGemini() {
    const schema = geminiResponseSchema(zodToJsonSchema(interviewReportSchema, { $refStrategy: "none" }))
    for (const field of LEGACY_RESPONSE_FIELDS) delete schema.properties[field]
    schema.required = schema.required.filter(field => !LEGACY_RESPONSE_FIELDS.includes(field))

    // Gemini rejects the array constraints in the skill-assessment branch,
    // while the remaining field types and enums are supported. Keep these
    // limits in the application Zod schema; they are enforced after parsing.
    delete schema.properties.skillAssessments.maxItems
    delete schema.properties.skillAssessments.minItems
    delete schema.properties.skillAssessments.items.properties.evidence.maxItems
    delete schema.properties.skillAssessments.items.properties.evidence.minItems

    return schema
}

const geminiResumeAnalysisSchema = z.object({
    overallSummary: boundedText(2000),
    experienceAlignment: boundedText(2000),
    strengths: z.array(boundedText(500)).max(10),
    areasOfImprovement: z.array(boundedText(500)).max(10),
    educationCertificationAnalysis: boundedText(2000),
    resumeQualityAnalysis: boundedText(2000)
})

function geminiResumeAnalysisProviderSchema() {
    const schema = geminiResponseSchema(zodToJsonSchema(geminiResumeAnalysisSchema, { $refStrategy: "none" }))
    delete schema.properties.strengths.maxItems
    delete schema.properties.strengths.minItems
    delete schema.properties.areasOfImprovement.maxItems
    delete schema.properties.areasOfImprovement.minItems
    return schema
}

const categoryAssessmentSchema = z.object({
    category: scoreCategorySchema,
    score: z.number().int().min(0).max(100),
    evidence: evidenceSchema,
    explanation: boundedText(1000)
})

const eligibilityMetricSchema = z.object({
    status: eligibilityStatusSchema,
    requirement: z.string().trim().max(500).optional(),
    evidence: z.array(boundedText(500)).max(3),
    explanation: boundedText(500)
})

const interviewReportSchema = z.object({
    analysisVersion: z.literal("1.0"),
    overallSummary: boundedText(2000),
    categoryAssessments: z.array(categoryAssessmentSchema).length(5),
    eligibility: z.object({
        minimumExperience: eligibilityMetricSchema,
        requiredCertifications: eligibilityMetricSchema,
        education: eligibilityMetricSchema,
        otherMandatoryRequirements: z.array(eligibilityMetricSchema.extend({
            requirement: boundedText(500)
        })).max(5)
    }),
    skillAssessments: z.array(z.object({
        skill: boundedText(200),
        status: skillStatusSchema,
        importance: importanceSchema,
        evidence: z.array(boundedText(500)).max(3),
        explanation: boundedText(500)
    })).max(50),
    strengths: z.array(z.object({ title: boundedText(200), evidence: z.array(boundedText(500)).max(3), explanation: boundedText(500) })).max(10),
    areasOfImprovement: z.array(z.object({ title: boundedText(200), evidence: z.array(boundedText(500)).max(3), recommendation: boundedText(500) })).max(10),
    resumeGaps: z.array(z.object({ title: boundedText(200), evidence: z.array(boundedText(500)).max(3), relatedRequirement: boundedText(500), explanation: boundedText(500) })).max(20),
    experienceAlignment: z.object({
        status: z.enum([ "Aligned", "Partially Aligned", "Not Aligned", "Unknown" ]),
        alignedEvidence: z.array(boundedText(500)).max(5),
        gaps: z.array(boundedText(500)).max(5),
        explanation: boundedText(1000)
    }),
    educationCertificationAnalysis: z.object({
        educationFindings: z.array(boundedText(500)).max(10),
        certificationFindings: z.array(boundedText(500)).max(10),
        explanation: boundedText(1000)
    }),
    toneStyleAnalysis: z.object({
        tone: boundedText(500),
        writingFindings: z.array(boundedText(500)).max(10),
        formattingFindings: z.array(boundedText(500)).max(10),
        atsRisks: z.array(boundedText(500)).max(10),
        recommendations: z.array(boundedText(500)).max(10)
    }),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Technical questions that can be asked in the interview along with their intention and how to answer them"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Behavioral questions that can be asked in the interview along with their intention and how to answer them"),
    skillGaps: z.array(z.object({
        skill: z.string().describe("The skill which the candidate is lacking"),
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap, i.e. how important is this skill for the job and how much it can impact the candidate's chances")
    })).describe("List of skill gaps in the candidate's profile along with their severity"),
    title: z.string().describe("The title of the job for which the interview report is generated"),
}).superRefine((report, context) => {
    const categories = report.categoryAssessments.map(({ category }) => category)
    const expected = Object.keys(CATEGORY_WEIGHTS)
    const unique = new Set(categories)
    if (unique.size !== categories.length || unique.size !== expected.length || expected.some(category => !unique.has(category))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [ "categoryAssessments" ], message: "Exactly one assessment is required for each scoring category" })
    }
})

function calculateOverallMatchScore(categoryAssessments) {
    const scores = new Map(categoryAssessments.map(({ category, score }) => [ category, score ]))
    const hasAllCategories = Object.keys(CATEGORY_WEIGHTS).every(category => scores.has(category))
    if (!hasAllCategories) throw new Error("AI response is missing a scoring category")

    return Math.round(Object.entries(CATEGORY_WEIGHTS).reduce(
        (total, [ category, weight ]) => total + scores.get(category) * weight,
        0
    ))
}

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {


    const prompt = `Generate a Resume Analysis report for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}

                        Return analysisVersion "1.0". Assess hiring fit across exactly these five categories: coreTechnicalSkills (programming languages, frameworks, methodologies, and technical competencies), relevantExperience (professional employment scope and outcomes; projects are not automatically employment), toolsAndTechnologies (named platforms and software such as Salesforce, AWS, Docker, and Jira), domainResponsibilityAlignment (domain and role responsibilities), and educationAndCertifications (explicit credentials only). Do not count the same evidence twice across categories. A framework may be assessed as a core skill when evaluating technical capability; named platforms and software should be assessed under tools. Do not include work authorization.
                        Use Met, Not Met, or Unknown for eligibility. Use Unknown when evidence is insufficient; missing resume evidence is not proof that a qualification is absent. Use Matched, Partial, Missing, or Needs Verification for skills. Include evidence for every assessment. Do not generate a preparationPlan in this response. Technical and behavioral questions may be preserved for future Mock Interview compatibility, but are not part of Resume Analysis display.
`

    let response
    try {
        response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisResponseSchemaForGemini(),
            }
        })
    } catch (error) {
        throw new ResumeAnalysisServiceError("Gemini request failed", {
            stage: "gemini_request",
            cause: error,
            ...providerMetadata(error)
        })
    }

    let parsed
    try {
        if (typeof response?.text !== "string") throw new Error("Missing response text")
        parsed = JSON.parse(response.text)
    } catch (error) {
        throw new ResumeAnalysisServiceError("AI response was not valid JSON", {
            stage: "json_parsing",
            cause: error
        })
    }

    const validated = interviewReportSchema.safeParse({
        technicalQuestions: [],
        behavioralQuestions: [],
        skillGaps: [],
        ...parsed
    })
    if (!validated.success) {
        throw new ResumeAnalysisServiceError("AI response failed schema validation", {
            stage: "schema_validation",
            zodIssues: validated.error.issues.map(issue => ({
                path: issue.path.join("."),
                code: issue.code
            }))
        })
    }

    let matchScore
    try {
        matchScore = calculateOverallMatchScore(validated.data.categoryAssessments)
    } catch (error) {
        throw new ResumeAnalysisServiceError("AI response failed score calculation", {
            stage: "score_calculation",
            cause: error
        })
    }

    return {
        ...validated.data,
        matchScore
    }


}

async function generateQualitativeResumeAnalysis({ resume, selfDescription, jobDescription }) {
    const prompt = `Generate a concise qualitative resume analysis using only the supplied candidate resume, self-description, and job description.
Resume: ${resume}
Self Description: ${selfDescription}
Job Description: ${jobDescription}

Return only the six requested fields. Do not calculate scores. Do not classify skills, determine eligibility, extract requirements, or invent experience, achievements, credentials, or facts. Use only evidence present in the supplied material.`

    let response
    try {
        response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: geminiResumeAnalysisProviderSchema(),
            }
        })
    } catch (error) {
        throw new ResumeAnalysisServiceError("Gemini qualitative analysis request failed", {
            stage: "gemini_request",
            cause: error,
            ...providerMetadata(error)
        })
    }

    let parsed
    try {
        if (typeof response?.text !== "string") throw new Error("Missing response text")
        parsed = JSON.parse(response.text)
    } catch (error) {
        throw new ResumeAnalysisServiceError("Gemini qualitative analysis was not valid JSON", {
            stage: "json_parsing",
            cause: error
        })
    }

    const validated = geminiResumeAnalysisSchema.safeParse(parsed)
    if (!validated.success) {
        throw new ResumeAnalysisServiceError("Gemini qualitative analysis failed schema validation", {
            stage: "schema_validation",
            zodIssues: validated.error.issues.map(issue => ({
                path: issue.path.join("."),
                code: issue.code
            }))
        })
    }

    return validated.data
}



async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch()
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" })

    const pdfBuffer = await page.pdf({
        format: "A4", margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm"
        }
    })

    await browser.close()

    return pdfBuffer
}

async function generateResumePdf({ resume, selfDescription, jobDescription, analysisContext = null }) {

    const resumePdfSchema = z.object({
        html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
    })

    const context = analysisContext && typeof analysisContext === "object" ? JSON.stringify(analysisContext) : "No persisted V2 analysis context is available."
    const prompt = `Generate resume for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}
                        Persisted Resume Analysis Context: ${context}

                        the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
                        The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
                        The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
                        you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
                        The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
                        The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.

                        Evidence and factual-integrity rules:
                        - Treat the persisted analysis as guidance, not as permission to invent facts.
                        - Prioritize experience, projects, education, certifications, and technologies already supported by the original resume evidence.
                        - Confirmed skills represent user-reported familiarity only. They may appear in the general Technical Skills section, normalized and without duplicates.
                        - Never use a confirmed skill to claim professional experience, project usage, production deployment, duration, responsibilities, achievements, certifications, or education.
                        - Never add a confirmed skill to an existing project's technology stack unless the original resume evidence explicitly associates it with that project.
                        - Do not create projects, employers, credentials, achievements, metrics, or unsupported technology claims.
                        - Preserve the original resume's factual content, section hierarchy, and meaning while improving clarity and tailoring emphasis to the job description.
                    `

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(resumePdfSchema),
        }
    })


    const jsonContent = JSON.parse(response.text)

    const pdfBuffer = await generatePdfFromHtml(jsonContent.html)

    return pdfBuffer

}

module.exports = {
    generateInterviewReport,
    generateQualitativeResumeAnalysis,
    generateResumePdf,
    interviewReportSchema,
    geminiResumeAnalysisSchema,
    analysisResponseSchemaForGemini,
    geminiResumeAnalysisProviderSchema,
    CATEGORY_WEIGHTS,
    calculateOverallMatchScore
}
