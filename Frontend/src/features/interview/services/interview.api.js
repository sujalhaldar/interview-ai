import axios from "axios";
import { createSseParser } from "./interview.sse.js"
import { getExpectedUserId } from "../../auth/session.identity.js"
import { API_BASE_URL } from "../../../config/api.js"
const api = axios.create({ baseURL: API_BASE_URL, withCredentials: true })
api.interceptors.request.use(config => {
    const userId = getExpectedUserId()
    if (!userId) return Promise.reject(Object.assign(new Error("Authentication session is changing."), { code: "AUTH_TRANSITION" }))
    config.headers["X-Expected-User-Id"] = userId
    return config
})

export const generateInterviewReport = async ({ jobDescription, selfDescription, resumeFile, idempotencyKey, onProgress }) => {
    const expectedUserId = getExpectedUserId()
    if (!expectedUserId) throw Object.assign(new Error("Authentication session is changing."), { code: "AUTH_TRANSITION" })
    const formData = new FormData()
    formData.append("jobDescription", jobDescription)
    formData.append("selfDescription", selfDescription)
    formData.append("resume", resumeFile)
    const response = await fetch(`${API_BASE_URL}/api/interview/`, { method: "POST", body: formData, credentials: "include", headers: { Accept: "text/event-stream", "Idempotency-Key": idempotencyKey, ...(expectedUserId ? { "X-Expected-User-Id": expectedUserId } : {}) } })
    if (!response.ok) {
        let body = {}
        try { body = await response.json() } catch { /* non-JSON response */ }
        const error = new Error(body.message || "Resume analysis request failed.")
        error.response = { status: response.status, data: body }
        throw error
    }
    if (!response.body) throw new Error("Resume analysis stream was unavailable.")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let completed = null
    const parser = createSseParser({ onProgress, onError: payload => { throw Object.assign(new Error(payload.message || "Resume analysis failed."), { code: payload.code }) } })
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        parser.consume(decoder.decode(value, { stream: true }))
    }
    parser.consume(decoder.decode())
    completed = parser.finish()
    if (!completed) throw new Error("Resume analysis stream ended before completion.")
    return { interviewReport: completed }
}

export const getInterviewReportById = async (interviewId) => (await api.get(`/api/interview/report/${interviewId}`)).data
export const markReportOpened = async (interviewId) => (await api.patch(`/api/interview/report/${interviewId}/open`)).data
export const getAllInterviewReports = async () => (await api.get("/api/interview/")).data
export const generateResumePdf = async ({ interviewReportId }) => (await api.post(`/api/interview/resume/pdf/${interviewReportId}`, null, { responseType: "blob" })).data
export const updateConfirmedSkills = async ({ interviewReportId, skills }) => (await api.patch("/api/interview/report/" + interviewReportId + "/confirmed-skills", { skills })).data
export const updateReportTitle = async ({ interviewReportId, title }) => (await api.patch(`/api/interview/report/${interviewReportId}/title`, { title })).data
export const updateReportPin = async ({ interviewReportId, isPinned }) => (await api.patch(`/api/interview/report/${interviewReportId}/pin`, { isPinned })).data
export const deleteInterviewReport = async (interviewReportId) => (await api.delete(`/api/interview/report/${interviewReportId}`)).data
