import { createContext,useCallback,useContext,useEffect,useRef,useState } from "react";
import { AuthContext } from "../auth/auth.context";
import { getAllInterviewReports, updateReportPin } from "./services/interview.api";
import { isReportIdentityReady } from "./report-detail.lifecycle.js";


export const InterviewContext = createContext()

export const InterviewProvider = ({ children }) => {
    const { user, loading: authLoading } = useContext(AuthContext)
    const [loading, setLoading] = useState(false)
    const [analysisLoading, setAnalysisLoading] = useState(false)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyLoaded, setHistoryLoaded] = useState(false)
    const [analysisProgress, setAnalysisProgress] = useState(null)
    const [report, setReport] = useState(null)
    const [reportLoading, setReportLoading] = useState(false)
    const [reportError, setReportError] = useState(null)
    const [reports, setReports] = useState([])
    const [reportsError, setReportsError] = useState('')
    const previousUserId = useRef(user?.id || null)
    const currentUserId = user?.id || null
    const currentUserIdRef = useRef(currentUserId)
    const historyRequestGeneration = useRef(0)
    const historyInFlight = useRef(null)
    const [sessionGeneration, setSessionGeneration] = useState(0)
    const [readyUserId, setReadyUserId] = useState(user?.id || null)
    const identityReady = isReportIdentityReady({ authLoading, userId: currentUserId, readyUserId })

    const refreshReports = useCallback(({ silent = false } = {}) => {
        const requestUserId = currentUserIdRef.current
        if (!requestUserId) {
            setReports([])
            setReportsError('')
            setHistoryLoaded(false)
            setHistoryLoading(false)
            return []
        }
        if (historyInFlight.current?.userId === requestUserId) return historyInFlight.current.promise
        const requestGeneration = ++historyRequestGeneration.current
        if (!silent) setHistoryLoading(true)
        if (!silent) setHistoryLoaded(false)
        setReportsError('')
        const request = getAllInterviewReports().then(response => {
            if (requestGeneration !== historyRequestGeneration.current || currentUserIdRef.current !== requestUserId) return []
            setReports(response.interviewReports)
            setHistoryLoaded(true)
            return response.interviewReports
        }).catch(error => {
            if (requestGeneration !== historyRequestGeneration.current || currentUserIdRef.current !== requestUserId) return []
            const status = error?.response?.status
            setReportsError(status === 401 ? 'Your session has expired. Please sign in again.' : 'Unable to load your reports. Please try again.')
            setHistoryLoaded(true)
            return []
        }).finally(() => {
            if (!silent && requestGeneration === historyRequestGeneration.current && currentUserIdRef.current === requestUserId) setHistoryLoading(false)
            if (historyInFlight.current?.promise === request) historyInFlight.current = null
        })
        historyInFlight.current = { userId: requestUserId, promise: request }
        return request
    }, [ setHistoryLoading, setReports, setReportsError ])

    const pinReport = useCallback(async (interviewReportId, isPinned) => {
        const response = await updateReportPin({ interviewReportId, isPinned })
        await refreshReports({ silent: true })
        return response.interviewReport
    }, [ refreshReports ])

    useEffect(() => {
        currentUserIdRef.current = currentUserId
    }, [ currentUserId ])

    useEffect(() => {
        const nextUserId = user?.id || null
        if (nextUserId === previousUserId.current) return
        previousUserId.current = nextUserId
        historyRequestGeneration.current += 1
        historyInFlight.current = null
        setReports([])
        setReport(null)
        setReportLoading(false)
        setReportError(null)
        setReportsError('')
        setHistoryLoaded(false)
        setAnalysisLoading(false)
        setHistoryLoading(Boolean(nextUserId))
        setAnalysisProgress(null)
        setSessionGeneration(value => value + 1)
        setReadyUserId(nextUserId)
    }, [ user?.id ])

    useEffect(() => {
        if (currentUserId) refreshReports()
        else {
            setHistoryLoaded(false)
            setHistoryLoading(false)
        }
    }, [ currentUserId, refreshReports ])

    return (
        <InterviewContext.Provider value={{ loading, setLoading, analysisLoading, setAnalysisLoading, historyLoading, setHistoryLoading, historyLoaded, analysisProgress, setAnalysisProgress, report, setReport, reportLoading, setReportLoading, reportError, setReportError, reports, setReports, reportsError, setReportsError, refreshReports, pinReport, user, sessionGeneration, identityReady }}>
            {children}
        </InterviewContext.Provider>
    )
}
