import { useCallback, useContext, useEffect, useRef } from "react"
import { InterviewContext } from "../interview.context"
import { useParams } from "react-router"
import { runReportDetailRequest } from "../report-detail.lifecycle.js"
import { generateInterviewReport, getInterviewReportById, markReportOpened, generateResumePdf, updateConfirmedSkills, updateReportTitle, deleteInterviewReport } from "../services/interview.api"


export const useInterview = () => {

    const context = useContext(InterviewContext)
    const { interviewId } = useParams()

    if (!context) {
        throw new Error("useInterview must be used within an InterviewProvider")
    }

    const { loading, setLoading, analysisLoading, setAnalysisLoading, historyLoading, analysisProgress, setAnalysisProgress, report, setReport, reportLoading, setReportLoading, reportError, setReportError, reports, setReports, reportsError, user, sessionGeneration, identityReady, refreshReports, pinReport: pinReportMutation } = context
    const detailRequestGeneration = useRef(0)
    const activeDetailRequest = useRef(null)
    const identityRef = useRef({ userId: user?.id || null, sessionGeneration })
    if (identityRef.current.userId !== (user?.id || null) || identityRef.current.sessionGeneration !== sessionGeneration) {
        identityRef.current = { userId: user?.id || null, sessionGeneration }
    }
    useEffect(() => {
        identityRef.current = { userId: user?.id || null, sessionGeneration }
    }, [ user?.id, sessionGeneration ])

    const generateReport = async ({ jobDescription, selfDescription, resumeFile, idempotencyKey }) => {
        setAnalysisLoading(true)
        setAnalysisProgress({ stage: "resume", status: "started" })
        try {
            const response = await generateInterviewReport({ jobDescription, selfDescription, resumeFile, idempotencyKey, onProgress: setAnalysisProgress })
            setReport(response.interviewReport)
            await refreshReports({ silent: true })
            return response.interviewReport
        } finally {
            setAnalysisLoading(false)
            setAnalysisProgress(null)
        }
    }

    const getReportById = useCallback((interviewId) => {
        const requestIdentity = identityRef.current
        if (!identityReady || !requestIdentity.userId) return Promise.resolve(null)
        const requestKey = `${interviewId}:${requestIdentity.userId}:${requestIdentity.sessionGeneration}`
        if (activeDetailRequest.current?.key === requestKey) return activeDetailRequest.current.promise

        const requestGeneration = ++detailRequestGeneration.current
        const isCurrent = () => requestGeneration === detailRequestGeneration.current && identityRef.current.userId === requestIdentity.userId && identityRef.current.sessionGeneration === requestIdentity.sessionGeneration
        setReport(null)
        setReportError(null)
        setReportLoading(true)
        const request = runReportDetailRequest({
            load: async () => (await getInterviewReportById(interviewId)).interviewReport,
            markOpened: () => markReportOpened(interviewId),
            isCurrent,
            onSuccess: setReport,
            onError: setReportError,
            onSettled: () => setReportLoading(false),
        })
        const promise = request.finally(() => {
            if (activeDetailRequest.current?.promise === promise) activeDetailRequest.current = null
        })
        activeDetailRequest.current = { key: requestKey, promise }
        return promise
    }, [ identityReady, setReport, setReportError, setReportLoading ])

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

    const pinReport = async (interviewReportId, isPinned) => ({ interviewReport: await pinReportMutation(interviewReportId, isPinned) })

    const removeReport = async (interviewReportId) => {
        await deleteInterviewReport(interviewReportId)
        setReports(previous => previous.filter(item => item._id !== interviewReportId))
        if (report?._id === interviewReportId) setReport(null)
    }

    useEffect(() => {
        if (!interviewId) return
        if (!identityReady) {
            detailRequestGeneration.current += 1
            activeDetailRequest.current = null
            setReportLoading(false)
            setReport(null)
            setReportError(null)
            return
        }
        void getReportById(interviewId)
    }, [ interviewId, identityReady, sessionGeneration, getReportById, setReport, setReportError, setReportLoading ])

    return { loading, reportLoading, reportError, identityReady, analysisLoading, historyLoading, analysisProgress, report, reports, reportsError, generateReport, getReportById, getResumePdf, saveConfirmedSkills, renameReport, pinReport, removeReport }

}
