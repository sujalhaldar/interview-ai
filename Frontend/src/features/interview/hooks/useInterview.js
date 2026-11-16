import { getAllInterviewReports, generateInterviewReport, getInterviewReportById, generateResumePdf, updateConfirmedSkills, updateReportTitle, updateReportPin, deleteInterviewReport } from "../services/interview.api"
import { useCallback, useContext, useEffect, useRef } from "react"
import { InterviewContext } from "../interview.context"
import { useParams } from "react-router"


export const useInterview = () => {

    const context = useContext(InterviewContext)
    const { interviewId } = useParams()

    if (!context) {
        throw new Error("useInterview must be used within an InterviewProvider")
    }

    const { loading, setLoading, analysisProgress, setAnalysisProgress, report, setReport, reports, setReports, reportsError, setReportsError } = context
    const historyRequestGeneration = useRef(0)
    const historyRefreshError = useRef(null)

    const generateReport = async ({ jobDescription, selfDescription, resumeFile, idempotencyKey }) => {
        setLoading(true)
        setAnalysisProgress({ stage: "resume", status: "started" })
        try {
            const response = await generateInterviewReport({ jobDescription, selfDescription, resumeFile, idempotencyKey, onProgress: setAnalysisProgress })
            setReport(response.interviewReport)
            return response.interviewReport
        } finally {
            setLoading(false)
            setAnalysisProgress(null)
        }
    }

    const getReportById = useCallback(async (interviewId) => {
        setLoading(true)
        try {
            const response = await getInterviewReportById(interviewId)
            setReport(response.interviewReport)
            return response.interviewReport
        } catch (error) {
            setReport(null)
            throw error
        } finally {
            setLoading(false)
        }
    }, [ setLoading, setReport ])

    const getReports = useCallback(async ({ silent = false } = {}) => {
        const requestGeneration = ++historyRequestGeneration.current
        historyRefreshError.current = null
        if (!silent) setLoading(true)
        setReportsError('')
        let response = null
        try {
            response = await getAllInterviewReports()
            if (requestGeneration === historyRequestGeneration.current) setReports(response.interviewReports)
            if (requestGeneration === historyRequestGeneration.current) historyRefreshError.current = null
            return response.interviewReports
        } catch (error) {
            console.log(error)
            if (requestGeneration === historyRequestGeneration.current) {
                historyRefreshError.current = error
                setReportsError(error?.response?.data?.message || 'Unable to refresh your recent analyses.')
            }
            return []
        } finally {
            if (!silent && requestGeneration === historyRequestGeneration.current) setLoading(false)
        }
    }, [ setLoading, setReports, setReportsError ])

    const getResumePdf = async (interviewReportId) => {
        setLoading(true)
        let response = null
        try {
            response = await generateResumePdf({ interviewReportId })
            const url = window.URL.createObjectURL(new Blob([ response ], { type: "application/pdf" }))
            const link = document.createElement("a")
            link.href = url
            link.setAttribute("download", `resume_${interviewReportId}.pdf`)
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
        } finally {
            setLoading(false)
        }
    }

    const saveConfirmedSkills = async (interviewReportId, skills) => {
        setLoading(true)
        try {
            const response = await updateConfirmedSkills({ interviewReportId, skills })
            setReport(response.interviewReport)
            return response.interviewReport
        } finally {
            setLoading(false)
        }
    }

    const renameReport = async (interviewReportId, title) => {
        const response = await updateReportTitle({ interviewReportId, title })
        setReports(previous => previous.map(item => item._id === interviewReportId ? { ...item, ...response.interviewReport } : item))
        if (report?._id === interviewReportId) setReport(response.interviewReport)
        return response.interviewReport
    }

    const pinReport = async (interviewReportId, isPinned) => {
        const response = await updateReportPin({ interviewReportId, isPinned })
        await getReports({ silent: true })
        return { interviewReport: response.interviewReport, historyRefreshError: historyRefreshError.current }
    }

    const removeReport = async (interviewReportId) => {
        await deleteInterviewReport(interviewReportId)
        setReports(previous => previous.filter(item => item._id !== interviewReportId))
        if (report?._id === interviewReportId) setReport(null)
    }

    useEffect(() => {
        if (interviewId) {
            getReportById(interviewId)
        } else {
            getReports()
        }
    }, [ interviewId, getReportById, getReports ])

    return { loading, analysisProgress, report, reports, reportsError, generateReport, getReportById, getReports, getResumePdf, saveConfirmedSkills, renameReport, pinReport, removeReport }

}
