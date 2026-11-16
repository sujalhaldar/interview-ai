import { createContext,useState } from "react";


export const InterviewContext = createContext()

export const InterviewProvider = ({ children }) => {
    const [loading, setLoading] = useState(false)
    const [analysisProgress, setAnalysisProgress] = useState(null)
    const [report, setReport] = useState(null)
    const [reports, setReports] = useState([])
    const [reportsError, setReportsError] = useState('')

    return (
        <InterviewContext.Provider value={{ loading, setLoading, analysisProgress, setAnalysisProgress, report, setReport, reports, setReports, reportsError, setReportsError }}>
            {children}
        </InterviewContext.Provider>
    )
}
