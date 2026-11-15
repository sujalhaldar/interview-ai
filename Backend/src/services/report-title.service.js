const TITLE_LABEL = /^(job\s+title|position|designation)\s*:\s*(.*)$/i
const INVALID_TITLE = /^(about(?: the)? role|responsibilities|requirements?|qualifications?|preferred qualifications?|what you'll do|what you'll need|about us|benefits|skills)\s*:?[\s.]*$/i

function cleanTitle(value) {
    if (typeof value !== "string") return null
    const title = value.replace(/\s+/g, " ").trim().replace(/[|,;:.]+$/, "").trim()
    if (!title || title.length > 160 || INVALID_TITLE.test(title)) return null
    return title
}

function extractExplicitJobTitle(jobDescription = "") {
    if (typeof jobDescription !== "string" || !jobDescription.trim()) return null
    const lines = jobDescription.replace(/\r\n?/g, "\n").split("\n")
    for (let index = 0; index < lines.length; index += 1) {
        const match = TITLE_LABEL.exec(lines[index].trim())
        if (!match) continue
        const sameLine = cleanTitle(match[2])
        if (sameLine) return sameLine
        const followingLine = cleanTitle(lines[index + 1])
        if (followingLine && !TITLE_LABEL.test(lines[index + 1].trim())) return followingLine
    }
    return null
}

function formatFallbackDate(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(value.getTime())) throw new TypeError("Invalid title date")
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value)
}

function generateReportTitle({ jobDescription, requestedTitle, now = new Date() } = {}) {
    const supplied = cleanTitle(requestedTitle)
    if (supplied) return supplied
    return extractExplicitJobTitle(jobDescription) || `Resume Analysis — ${formatFallbackDate(now)}`
}

module.exports = { extractExplicitJobTitle, formatFallbackDate, generateReportTitle }
