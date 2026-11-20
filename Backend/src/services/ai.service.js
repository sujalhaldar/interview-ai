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
    constructor(message, { stage, cause, upstreamStatus, providerCode, providerReason, providerMessage, zodIssues } = {}) {
        super(message, { cause })
        this.name = "ResumeAnalysisServiceError"
        this.stage = stage
        this.upstreamStatus = upstreamStatus
        this.providerCode = providerCode
        this.providerReason = providerReason
        this.providerMessage = providerMessage
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

function geminiResponseSchema(schema, { omitMaxItems = false } = {}) {
    const unsupported = new Set([ "$schema", "additionalProperties", "minLength", "maxLength", "minimum", "maximum" ])
    if (omitMaxItems) unsupported.add("maxItems")

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

function extractProviderError(error) {
    const directError = error?.response?.data?.error || error?.error
    if (directError && typeof directError === "object") return directError

    if (typeof error?.message !== "string") return undefined
    const jsonStart = error.message.indexOf("{")
    if (jsonStart < 0) return undefined
    try {
        return JSON.parse(error.message.slice(jsonStart))?.error
    } catch {
        return undefined
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sanitizeProviderMessage(message, sensitiveValues = []) {
    let sanitized = typeof message === "string" ? message : ""
    for (const value of sensitiveValues) {
        if (typeof value === "string" && value.trim().length >= 4) {
            sanitized = sanitized.replace(new RegExp(escapeRegExp(value.trim()), "gi"), "[redacted]")
        }
    }
    return sanitized
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
        .replace(/\+?\d[\d(). -]{7,}\d/g, "[redacted-number]")
        .replace(/[\r\n\t\0-\x1f\x7f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240)
}

function resumePdfProviderMetadata(error, sensitiveValues) {
    const providerError = extractProviderError(error)
    const httpStatus = [ error?.status, error?.statusCode, error?.response?.status, providerError?.code ]
        .find(value => Number.isInteger(value))
    const providerCode = [ providerError?.status, providerError?.code, error?.code ]
        .find(value => (typeof value === "string" || Number.isInteger(value)) && String(value).length <= 80)
    const providerReason = Array.isArray(providerError?.details)
        ? providerError.details.find(detail => typeof detail?.reason === "string")?.reason
        : undefined
    const rawMessage = typeof providerError?.message === "string" ? providerError.message : error?.message

    return {
        httpStatus,
        providerCode: providerCode === undefined ? undefined : sanitizeProviderMessage(String(providerCode), sensitiveValues).slice(0, 80),
        providerReason: typeof providerReason === "string" ? sanitizeProviderMessage(providerReason, sensitiveValues).slice(0, 80) : undefined,
        providerMessage: sanitizeProviderMessage(rawMessage, sensitiveValues)
    }
}

function safeRequestId(requestId) {
    return typeof requestId === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(requestId) ? requestId : undefined
}

function logResumePdfFailure(failureStage, error, { requestId, providerMetadata, zodIssues } = {}) {
    const requestIdValue = safeRequestId(requestId)
    console.error("Resume PDF generation failure", {
        workflow: "resume_pdf",
        failureStage,
        ...(requestIdValue ? { requestId: requestIdValue } : {}),
        errorName: error?.name || "Error",
        ...(Number.isInteger(providerMetadata?.httpStatus) ? { httpStatus: providerMetadata.httpStatus } : {}),
        ...(providerMetadata?.providerCode ? { providerCode: providerMetadata.providerCode } : {}),
        ...(providerMetadata?.providerReason ? { providerReason: providerMetadata.providerReason } : {}),
        ...(providerMetadata?.providerMessage ? { providerMessage: providerMetadata.providerMessage } : {}),
        ...(Array.isArray(zodIssues) ? { zodIssues } : {})
    })
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

/**
 * Legacy V1 Gemini-driven report generator.
 *
 * @deprecated New production report generation must use
 * generateQualitativeResumeAnalysis() with the deterministic V2 pipeline.
 * Do not use this function for new production workflows. It is retained
 * temporarily for backward compatibility pending external-consumer verification.
 */
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



const resumePdfEntrySchema = z.object({
    title: boundedText(180),
    subtitle: z.string().trim().max(180).optional(),
    dateRange: z.string().trim().max(80).optional(),
    bullets: z.array(boundedText(500)).max(8)
}).strict()

const resumePdfSectionSchema = z.object({
    heading: boundedText(100),
    entries: z.array(resumePdfEntrySchema).max(10)
}).strict()

const resumePdfSchema = z.object({
    fullName: boundedText(100),
    contactDetails: z.array(boundedText(160)).max(6),
    summary: z.string().trim().max(1500).optional(),
    sections: z.array(resumePdfSectionSchema).max(12)
}).strict()

const MAX_RESUME_PDF_INPUT_CHARS = 100_000
const MAX_RESUME_PDF_RESPONSE_CHARS = 64 * 1024
const PDF_BROWSER_TIMEOUT_MS = 15_000
const PDF_CONTENT_TIMEOUT_MS = 10_000

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character])
}

function renderResumeHtml(resume) {
    const contactDetails = resume.contactDetails.map(value => `<span>${escapeHtml(value)}</span>`).join("")
    const summary = resume.summary ? `<section><h2>Summary</h2><p>${escapeHtml(resume.summary)}</p></section>` : ""
    const sections = resume.sections.map(section => {
        const entries = section.entries.map(entry => `
            <article>
                <div class="entry-heading"><h3>${escapeHtml(entry.title)}</h3>${entry.dateRange ? `<span>${escapeHtml(entry.dateRange)}</span>` : ""}</div>
                ${entry.subtitle ? `<p class="subtitle">${escapeHtml(entry.subtitle)}</p>` : ""}
                ${entry.bullets.length ? `<ul>${entry.bullets.map(bullet => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
            </article>`).join("")
        return `<section><h2>${escapeHtml(section.heading)}</h2>${entries}</section>`
    }).join("")

    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>
        * { box-sizing: border-box; } body { color: #202938; font: 11pt Arial, sans-serif; line-height: 1.4; }
        h1 { margin: 0 0 5px; font-size: 22pt; } h2 { margin: 18px 0 8px; padding-bottom: 3px; border-bottom: 1px solid #9aa5b1; font-size: 13pt; text-transform: uppercase; }
        h3 { margin: 0; font-size: 11pt; } p { margin: 5px 0; white-space: pre-wrap; } .contact { display: flex; flex-wrap: wrap; gap: 4px 12px; color: #475569; }
        .entry-heading { display: flex; justify-content: space-between; gap: 12px; } .subtitle { color: #475569; }
        article { margin: 0 0 10px; break-inside: avoid; } ul { margin: 5px 0 0; padding-left: 18px; } li { margin: 2px 0; white-space: pre-wrap; }
    </style></head><body><main><header><h1>${escapeHtml(resume.fullName)}</h1><div class="contact">${contactDetails}</div></header>${summary}${sections}</main></body></html>`
}

async function generatePdfFromHtml(htmlContent, { requestId } = {}) {
    let browser
    try {
        browser = await puppeteer.launch({ timeout: PDF_BROWSER_TIMEOUT_MS })
    } catch (error) {
        const failure = new ResumeAnalysisServiceError("Resume PDF browser launch failed", { stage: "puppeteer_launch", cause: error })
        logResumePdfFailure(failure.stage, failure, { requestId })
        throw failure
    }

    let renderFailure
    try {
        const page = await browser.newPage()
        await page.setJavaScriptEnabled(false)
        await page.setRequestInterception(true)
        page.on("request", request => request.abort().catch(() => {}))
        await page.setContent(htmlContent, { waitUntil: "domcontentloaded", timeout: PDF_CONTENT_TIMEOUT_MS })

        return await page.pdf({
            format: "A4",
            timeout: PDF_BROWSER_TIMEOUT_MS,
            margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }
        })
    } catch (error) {
        renderFailure = new ResumeAnalysisServiceError("Resume PDF rendering failed", { stage: "pdf_rendering", cause: error })
        logResumePdfFailure(renderFailure.stage, renderFailure, { requestId })
        throw renderFailure
    } finally {
        try {
            await browser.close()
        } catch (error) {
            if (!renderFailure) {
                const failure = new ResumeAnalysisServiceError("Resume PDF browser cleanup failed", { stage: "puppeteer_cleanup", cause: error })
                logResumePdfFailure(failure.stage, failure, { requestId })
                throw failure
            }
        }
    }
}

async function generateResumePdf({ resume, selfDescription, jobDescription, analysisContext = null, requestId }) {
    const context = analysisContext && typeof analysisContext === "object" ? JSON.stringify(analysisContext) : "No persisted V2 analysis context is available."
    const inputTextLength = [resume, selfDescription, jobDescription, context].reduce((total, value) => total + (typeof value === "string" ? value.length : 0), 0)
    if (inputTextLength > MAX_RESUME_PDF_INPUT_CHARS) throw new Error("Resume PDF input exceeds the size limit")
    const sensitiveValues = [resume, selfDescription, jobDescription, context]
    const prompt = `Generate resume for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}
                        Persisted Resume Analysis Context: ${context}

                        Return a JSON object matching the provided schema. Provide the candidate name, contact details, an optional summary, and up to 12 sections. Each section has a heading and up to 10 entries; entries have a title, optional subtitle and date range, and up to 8 factual bullet points. Return plain text only, never HTML, CSS, links, images, SVG, or code.
                        The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience.
                        The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
                        The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
                        The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.

                        Evidence and factual-integrity rules:
                        - Treat the persisted analysis as guidance, not as permission to invent facts.
                        - Prioritize experience, projects, education, certifications, and technologies already supported by the original resume evidence.
                        - Confirmed skills represent user-reported familiarity only. They may appear in the general Technical Skills section, normalized and without duplicates.
                        - Never use a confirmed skill to claim professional experience, project usage, production deployment, duration, responsibilities, achievements, certifications, or education.
                        - Never add a confirmed skill to an existing project's technology stack unless the original resume evidence explicitly associates it with that project.
                        - Do not create projects, employers, credentials, achievements, metrics, or unsupported technology claims.
                        - Preserve the original resume's factual content, section hierarchy, and meaning while improving clarity and tailoring emphasis to the job description.`

    let response
    try {
        response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: geminiResponseSchema(zodToJsonSchema(resumePdfSchema, { $refStrategy: "none" }), { omitMaxItems: true })
            }
        })
    } catch (error) {
        const metadata = resumePdfProviderMetadata(error, sensitiveValues)
        const failure = new ResumeAnalysisServiceError("Resume PDF Gemini request failed", {
            stage: "gemini_request",
            cause: error,
            upstreamStatus: metadata.httpStatus,
            providerCode: metadata.providerCode,
            providerReason: metadata.providerReason,
            providerMessage: metadata.providerMessage
        })
        if (Number.isInteger(metadata.httpStatus) && metadata.httpStatus >= 400 && metadata.httpStatus <= 599) {
            failure.status = metadata.httpStatus
        }
        logResumePdfFailure(failure.stage, failure, { requestId, providerMetadata: metadata })
        throw failure
    }

    if (typeof response?.text !== "string" || response.text.length > MAX_RESUME_PDF_RESPONSE_CHARS) {
        const failure = new ResumeAnalysisServiceError("Resume PDF model response is missing or exceeds the size limit", { stage: "response_validation" })
        logResumePdfFailure(failure.stage, failure, { requestId })
        throw failure
    }

    let parsed
    try {
        parsed = JSON.parse(response.text)
    } catch (error) {
        const failure = new ResumeAnalysisServiceError("Resume PDF model response was not valid JSON", { stage: "json_parsing", cause: error })
        logResumePdfFailure(failure.stage, failure, { requestId })
        throw failure
    }
    const validated = resumePdfSchema.safeParse(parsed)
    if (!validated.success) {
        const zodIssues = validated.error.issues.map(issue => ({ path: issue.path.join("."), code: issue.code }))
        const failure = new ResumeAnalysisServiceError("Resume PDF model response failed schema validation", {
            stage: "schema_validation",
            zodIssues
        })
        logResumePdfFailure(failure.stage, failure, { requestId, zodIssues })
        throw failure
    }

    let html
    try {
        html = renderResumeHtml(validated.data)
    } catch (error) {
        const failure = new ResumeAnalysisServiceError("Resume PDF HTML generation failed", { stage: "html_rendering", cause: error })
        logResumePdfFailure(failure.stage, failure, { requestId })
        throw failure
    }

    return generatePdfFromHtml(html, { requestId })
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
