import { createContext,useContext,useEffect,useRef,useState } from "react";
import { AuthContext } from "../auth/auth.context";


export const InterviewContext = createContext()

export const InterviewProvider = ({ children }) => {
    const { user } = useContext(AuthContext)
    const [loading, setLoading] = useState(false)
    const [analysisLoading, setAnalysisLoading] = useState(false)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [analysisProgress, setAnalysisProgress] = useState(null)
    const [report, setReport] = useState(null)
    const [reports, setReports] = useState([])
    const [reportsError, setReportsError] = useState('')
    const previousUserId = useRef(user?.id || null)
    const [sessionGeneration, setSessionGeneration] = useState(0)

    useEffect(() => {
        const nextUserId = user?.id || null
        if (nextUserId === previousUserId.current) return
        previousUserId.current = nextUserId
        queueMicrotask(() => {
            setReports([])
            setReport(null)
            setReportsError('')
            setAnalysisLoading(false)
            setHistoryLoading(false)
            setAnalysisProgress(null)
            setSessionGeneration(value => value + 1)
        })
    }, [ user?.id ])

    return (
        <InterviewContext.Provider value={{ loading, setLoading, analysisLoading, setAnalysisLoading, historyLoading, setHistoryLoading, analysisProgress, setAnalysisProgress, report, setReport, reports, setReports, reportsError, setReportsError, user, sessionGeneration }}>
            {children}
        </InterviewContext.Provider>
    )
}
