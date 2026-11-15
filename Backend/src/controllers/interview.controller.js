const pdfParse = require("pdf-parse")
const { generateQualitativeResumeAnalysis, generateResumePdf } = require("../services/ai.service")
const { extractJdRequirements } = require("../services/jd-requirements.service")
const { extractResumeEvidence } = require("../services/resume-evidence.service")
const { matchJdRequirements } = require("../services/jd-resume-matching.service")
const { assembleResumeAnalysisReport } = require("../services/resume-analysis-scoring.service")
const { mapResumeAnalysisReport } = require("../services/resume-analysis-report-mapper.service")
const dictionary = require("../services/jd-requirements.dictionary")
const interviewReportModel = require("../models/interviewReport.model")
const analysisIdempotencyModel = require("../models/analysis-idempotency.model")




/**
 * @description Controller to generate interview report based on user self description, resume and job description.
 */
async function generateInterViewReportController(req, res) {
    const { selfDescription, jobDescription } = req.body
    if (typeof jobDescription !== "string" || !jobDescription.trim()) return res.status(400).json({ message: "Job description is required." })
    if (!req.file) return res.status(400).json({ message: "Resume PDF is required." })
    const wantsStream = req.headers.accept?.includes("text/event-stream")
    const idempotencyKey = req.headers["idempotency-key"]
    let idempotencyRecord
    if (wantsStream && idempotencyKey) {
        if (typeof idempotencyKey !== "string" || idempotencyKey.length > 128) return res.status(400).json({ message: "Invalid idempotency key." })
        try {
            idempotencyRecord = await analysisIdempotencyModel.create({ user: req.user.id, key: idempotencyKey, status: "processing", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
        } catch (error) {
            if (error?.code !== 11000) throw error
            idempotencyRecord = await analysisIdempotencyModel.findOne({ user: req.user.id, key: idempotencyKey })
            if (idempotencyRecord?.status === "completed" && idempotencyRecord.report) {
                const existing = await interviewReportModel.findOne({ _id: idempotencyRecord.report, user: req.user.id })
                if (existing) return streamExistingReport(res, existing)
            }
            if (idempotencyRecord?.status === "processing") return res.status(409).json({ message: "Resume analysis is already in progress. Please retry shortly." })
            if (idempotencyRecord) await analysisIdempotencyModel.deleteOne({ _id: idempotencyRecord._id })
            idempotencyRecord = await analysisIdempotencyModel.create({ user: req.user.id, key: idempotencyKey, status: "processing", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
        }
    }
    let resumeContent
    let streamStarted = false
    let disconnected = false
    const send = (event, data) => {
        if (!streamStarted || disconnected || res.writableEnded || res.destroyed) return false
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        return true
    }
    const startStream = () => {
        if (!wantsStream) return
        streamStarted = true
        res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" })
        if (typeof res.flushHeaders === "function") res.flushHeaders()
        req.on("aborted", () => { disconnected = true })
        res.on("close", () => { if (!res.writableEnded) disconnected = true })
    }
    try {
        startStream()
        try {
            send("progress", { stage: "resume", status: "started" })
            resumeContent = await (new pdfParse.PDFParse(Uint8Array.from(req.file.buffer))).getText()
        } catch (error) {
            throw Object.assign(new Error("Resume text extraction failed"), { stage: "pdf_extraction", cause: error })
        }
        if (!resumeContent || typeof resumeContent.text !== "string" || !resumeContent.text.trim()) throw Object.assign(new Error("Resume text extraction failed"), { stage: "pdf_extraction" })
        const jdRequirements = extractJdRequirements(jobDescription)
        send("progress", { stage: "role", status: "completed" })
        const resumeEvidence = extractResumeEvidence(resumeContent.text)
        send("progress", { stage: "resume", status: "completed" })
        const matchingResult = matchJdRequirements(jdRequirements, resumeEvidence)
        send("progress", { stage: "matching", status: "completed" })
        const qualitativeAnalysis = await generateQualitativeResumeAnalysis({ resume: resumeContent.text, selfDescription, jobDescription })
        send("progress", { stage: "analysis", status: "started" })
        const scoringResult = assembleResumeAnalysisReport({ jdRequirements, resumeEvidence, matchingResult, qualitativeAnalysis })
        const mappedReport = mapResumeAnalysisReport({ scoringResult, qualitativeAnalysis })
        const interviewReport = await interviewReportModel.create({ user: req.user.id, resume: resumeContent.text, selfDescription, jobDescription, title: req.body.title || "Resume Analysis", ...mappedReport })
        if (idempotencyRecord) await analysisIdempotencyModel.findByIdAndUpdate(idempotencyRecord._id, { status: "completed", report: interviewReport._id })
        if (wantsStream) {
            send("progress", { stage: "analysis", status: "completed" })
            send("complete", { message: "Interview report generated successfully.", interviewReport })
            return res.end()
        }
        return res.status(201).json({ message: "Interview report generated successfully.", interviewReport })
    } catch (error) {
        console.error("Resume analysis service failure", {
            stage: error?.stage || "unknown",
            errorName: error?.name || "Error",
            ...(Number.isInteger(error?.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
            ...(typeof error?.providerCode === "string" ? { providerCode: error.providerCode } : {}),
            ...(Array.isArray(error?.zodIssues) ? { zodIssues: error.zodIssues } : {})
        })
        if (idempotencyRecord) await analysisIdempotencyModel.findByIdAndUpdate(idempotencyRecord._id, { status: "failed", expiresAt: new Date(Date.now() + 10 * 60 * 1000) }).catch(() => {})
        if (streamStarted) {
            send("error", { code: error?.stage || "analysis_failed", message: error?.stage === "pdf_extraction" ? "We couldn't read that resume PDF." : "Resume analysis service is temporarily unavailable." })
            if (!res.writableEnded && !res.destroyed) res.end()
            return
        }
        const clientStatus = error?.stage === "pdf_extraction" ? 400 : 502
        return res.status(clientStatus).json({
            message: "Resume analysis service is temporarily unavailable."
        })
    }

}

function streamExistingReport(res, report) {
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" })
    if (typeof res.flushHeaders === "function") res.flushHeaders()
    res.write(`event: complete\ndata: ${JSON.stringify({ message: "Interview report generated successfully.", interviewReport: report })}\n\n`)
    return res.end()
}

/**
 * @description Controller to get interview report by interviewId.
 */
async function getInterviewReportByIdController(req, res) {

    const { interviewId } = req.params

    const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    res.status(200).json({
        message: "Interview report fetched successfully.",
        interviewReport
    })
}


/**
 * @description Controller to get all interview reports of logged in user.
 */
async function getAllInterviewReportsController(req, res) {
    const interviewReports = await interviewReportModel.find({ user: req.user.id }).sort({ createdAt: -1 }).select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan")

    res.status(200).json({
        message: "Interview reports fetched successfully.",
        interviewReports
    })
}


/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
    const { interviewReportId } = req.params

    const interviewReport = await interviewReportModel.findOne({
        _id: interviewReportId,
        user: req.user.id
    })

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    const { resume, jobDescription, selfDescription } = interviewReport
    const analysisContext = {
        analysisVersion: interviewReport.analysisVersion || null,
        confirmedSkills: (interviewReport.confirmedSkills || []).map(skill => ({
            normalizedName: skill.normalizedName,
            originalText: skill.originalText,
            sourceType: skill.sourceType,
            confidence: skill.confidence
        })),
        requirementAnalysis: interviewReport.requirementAnalysis || null,
        strengths: interviewReport.strengths || [],
        areasOfImprovement: interviewReport.areasOfImprovement || [],
        resumeGaps: interviewReport.resumeGaps || [],
        skillGaps: interviewReport.skillGaps || [],
        experienceAlignment: interviewReport.experienceAlignment || null,
        educationCertificationAnalysis: interviewReport.educationCertificationAnalysis || null
    }

    const pdfBuffer = await generateResumePdf({ resume, jobDescription, selfDescription, analysisContext })

    res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=resume_${interviewReportId}.pdf`
    })

    res.send(pdfBuffer)
}

function normalizeConfirmedSkills(values) {
    if (!Array.isArray(values) || values.length > 50 || values.some(value => typeof value !== "string" || !value.trim() || value.length > 100)) {
        const error = new Error("Invalid confirmed skills")
        error.statusCode = 400
        throw error
    }
    const result = []
    const seen = new Set()
    for (const value of values) {
        const normalizedInput = value.toLowerCase().replace(/[.\-_\s]/g, "")
        const entry = dictionary.find(item => item.aliases.some(alias => alias.toLowerCase().replace(/[.\-_\s]/g, "") === normalizedInput))
        const normalizedName = entry ? entry.normalizedName : value.replace(/\s+/g, " ").trim()
        const key = normalizedName.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ originalText: value.trim(), normalizedName, sourceType: "userConfirmed", confidence: "userConfirmed" })
    }
    return result
}

function addConfirmedEvidence(resumeEvidence, confirmedSkills) {
    const evidence = { ...resumeEvidence, skills: (resumeEvidence.skills || []).map(item => ({ ...item, evidence: Array.isArray(item.evidence) ? item.evidence.map(value => ({ ...value })) : [] })) }
    for (const skill of confirmedSkills) {
        const entry = dictionary.find(item => item.normalizedName === skill.normalizedName)
        const category = entry ? entry.category : "other"
        const item = { originalText: skill.originalText, normalizedValue: skill.normalizedName, category, evidence: [{ originalText: skill.originalText, normalizedValue: skill.normalizedName, category, sourceType: "userConfirmed", sourceSection: "userConfirmed", evidenceText: "User-confirmed familiarity", status: "explicit", confidence: "userConfirmed" }] }
        const existing = evidence.skills.find(value => value.normalizedValue === skill.normalizedName)
        if (existing) existing.evidence.push(...item.evidence)
        else evidence.skills.push(item)
    }
    return evidence
}

async function updateConfirmedSkillsController(req, res) {
    try {
        const report = await interviewReportModel.findOne({ _id: req.params.interviewId, user: req.user.id })
        if (!report) return res.status(404).json({ message: "Interview report not found." })
        const confirmedSkills = normalizeConfirmedSkills(req.body?.skills)
        const jdRequirements = extractJdRequirements(report.jobDescription)
        const resumeEvidence = extractResumeEvidence(report.resume || "")
        const matchingResult = matchJdRequirements(jdRequirements, addConfirmedEvidence(resumeEvidence, confirmedSkills))
        const qualitativeAnalysis = {
            overallSummary: report.overallSummary || "",
            experienceAlignment: typeof report.experienceAlignment === "string" ? report.experienceAlignment : "",
            strengths: Array.isArray(report.strengths) ? report.strengths.filter(item => typeof item === "string") : [],
            areasOfImprovement: Array.isArray(report.areasOfImprovement) ? report.areasOfImprovement.filter(item => typeof item === "string") : [],
            educationCertificationAnalysis: typeof report.educationCertificationAnalysis === "string" ? report.educationCertificationAnalysis : "",
            resumeQualityAnalysis: report.resumeQualityAnalysis || ""
        }
        const scoringResult = assembleResumeAnalysisReport({ jdRequirements, resumeEvidence, matchingResult, qualitativeAnalysis })
        const mappedReport = mapResumeAnalysisReport({ scoringResult, qualitativeAnalysis })
        const updated = await interviewReportModel.findOneAndUpdate(
            { _id: req.params.interviewId, user: req.user.id },
            { $set: { ...mappedReport, confirmedSkills, analysisRevision: (report.analysisRevision || 0) + 1 } },
            { new: true, runValidators: true }
        )
        if (!updated) return res.status(404).json({ message: "Interview report not found." })
        return res.status(200).json({ message: "Confirmed skills saved successfully.", interviewReport: updated })
    } catch (error) {
        if (error.statusCode === 400) return res.status(400).json({ message: "Confirmed skills must be an array of skill names." })
        console.error("Confirmed skills update failed", { errorName: error?.name || "Error" })
        return res.status(502).json({ message: "Unable to update resume analysis right now." })
    }
}

module.exports = { generateInterViewReportController, getInterviewReportByIdController, getAllInterviewReportsController, generateResumePdfController, updateConfirmedSkillsController, normalizeConfirmedSkills, addConfirmedEvidence }
