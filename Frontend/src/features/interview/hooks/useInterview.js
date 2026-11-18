import { getAllInterviewReports, generateInterviewReport, getInterviewReportById, markReportOpened, generateResumePdf, updateConfirmedSkills, updateReportTitle, updateReportPin, deleteInterviewReport } from "../services/interview.api"
import { useCallback, useContext, useEffect, useRef } from "react"
import { InterviewContext } from "../interview.context"
import { useParams } from "react-router"


export const useInterview = () => {

    const context = useContext(InterviewContext)
    const { interviewId } = useParams()

    if (!context) {
        throw new Error("useInterview must be used within an InterviewProvider")
    }

    const { loading, setLoading, analysisLoading, setAnalysisLoading, historyLoading, setHistoryLoading, analysisProgress, setAnalysisProgress, report, setReport, reports, setReports, reportsError, setReportsError, user, sessionGeneration } = context
    const historyRequestGeneration = useRef(0)
    const detailRequestGeneration = useRef(0)
    const historyRefreshError = useRef(null)
    const identityRef = useRef({ userId: user?.id || null, sessionGeneration })
    if (identityRef.current.userId !== (user?.id || null) || identityRef.current.sessionGeneration !== sessionGeneration) {
        identityRef.current = { userId: user?.id || null, sessionGeneration }
    }
    useEffect(() => {
        identityRef.current = { userId: user?.id || null, sessionGeneration }
        historyRequestGeneration.current += 1
    }, [ user?.id, sessionGeneration ])

    const generateReport = async ({ jobDescription, selfDescription, resumeFile, idempotencyKey }) => {
        setAnalysisLoading(true)
        setAnalysisProgress({ stage: "resume", status: "started" })
        try {
            const response = await generateInterviewReport({ jobDescription, selfDescription, resumeFile, idempotencyKey, onProgress: setAnalysisProgress })
            setReport(response.interviewReport)
            return response.interviewReport
        } finally {
            setAnalysisLoading(false)
            setAnalysisProgress(null)
        }
    }

    const getReportById = useCallback(async (interviewId) => {
        const requestGeneration = ++detailRequestGeneration.current
        const requestIdentity = identityRef.current
        setLoading(true)
        try {
            const response = await getInterviewReportById(interviewId)
            const currentIdentity = identityRef.current
            if (requestGeneration === detailRequestGeneration.current && currentIdentity.userId === requestIdentity.userId && currentIdentity.sessionGeneration === requestIdentity.sessionGeneration) setReport(response.interviewReport)
            try { await markReportOpened(interviewId) } catch { /* report retrieval remains usable if metadata tracking fails */ }
            return response.interviewReport
        } catch (error) {
            const currentIdentity = identityRef.current
            if (requestGeneration === detailRequestGeneration.current && currentIdentity.userId === requestIdentity.userId && currentIdentity.sessionGeneration === requestIdentity.sessionGeneration) setReport(null)
            throw error
        } finally {
            if (requestGeneration === detailRequestGeneration.current && identityRef.current.userId === requestIdentity.userId && identityRef.current.sessionGeneration === requestIdentity.sessionGeneration) setLoading(false)
        }
    }, [ setLoading, setReport ])

    const getReports = useCallback(async ({ silent = false } = {}) => {
        const requestGeneration = ++historyRequestGeneration.current
        const requestIdentity = identityRef.current
        historyRefreshError.current = null
        if (!silent) { setLoading(true); setHistoryLoading(true) }
        setReportsError('')
        let response = null
        try {
            response = await getAllInterviewReports()
            const currentIdentity = identityRef.current
            if (requestGeneration === historyRequestGeneration.current && currentIdentity.userId === requestIdentity.userId && currentIdentity.sessionGeneration === requestIdentity.sessionGeneration) setReports(response.interviewReports)
            if (requestGeneration === historyRequestGeneration.current && currentIdentity.userId === requestIdentity.userId && currentIdentity.sessionGeneration === requestIdentity.sessionGeneration) historyRefreshError.current = null
            return response.interviewReports
        } catch (error) {
            console.log(error)
            const currentIdentity = identityRef.current
            if (requestGeneration === historyRequestGeneration.current && currentIdentity.userId === requestIdentity.userId && currentIdentity.sessionGeneration === requestIdentity.sessionGeneration) {
                historyRefreshError.current = error
                setReportsError(error?.response?.data?.message || 'Unable to refresh your recent analyses.')
            }
            return []
        } finally {
            if (!silent && requestGeneration === historyRequestGeneration.current && identityRef.current.userId === requestIdentity.userId && identityRef.current.sessionGeneration === requestIdentity.sessionGeneration) { setLoading(false); setHistoryLoading(false) }
        }
    }, [ setHistoryLoading, setLoading, setReports, setReportsError ])

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
        }
        getReports()
    }, [ interviewId, getReportById, getReports ])

    return { loading, analysisLoading, historyLoading, analysisProgress, report, reports, reportsError, generateReport, getReportById, getReports, getResumePdf, saveConfirmedSkills, renameReport, pinReport, removeReport }

}
