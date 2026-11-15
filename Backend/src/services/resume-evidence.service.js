const dictionary = require("./jd-requirements.dictionary")

const SOURCE_TYPES = ["skillsSection", "professionalExperience", "project", "summary", "education", "certification", "other"]
const STATUS_VALUES = ["explicit", "ambiguous", "unknown"]
const CONFIDENCE_VALUES = ["high", "medium", "low"]

function normalize(value) {
    return value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim()
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const aliases = dictionary
    .flatMap(entry => entry.aliases.map(alias => ({ ...entry, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)

function findTechnologyMatches(text) {
    const matches = []
    for (const entry of aliases) {
        const pattern = new RegExp(`(?<![a-z0-9+#])${escapeRegExp(entry.alias)}(?![a-z0-9+#])`, "i")
        const match = pattern.exec(text)
        if (!match) continue
        const start = match.index
        const end = start + match[0].length
        if (matches.some(item => start < item.end && end > item.start)) continue
        matches.push({ ...entry, originalText: match[0], start, end })
    }
    return matches.sort((a, b) => a.start - b.start)
}

function evidence(originalText, normalizedValue, category, sourceType, sourceSection, evidenceText, status = "explicit", confidence = "high") {
    return { originalText, normalizedValue, category, sourceType, sourceSection, evidenceText, status, confidence }
}

function sectionName(line) {
    const value = normalize(line).replace(/[:\-]+$/, "")
    if (/^(summary|profile|about me)$/.test(value)) return "summary"
    if (/^(skills|technical skills|core skills|technologies)$/.test(value)) return "skills"
    if (/^(experience|work experience|professional experience|employment|work history)$/.test(value)) return "experience"
    if (/^(projects|personal projects|selected projects)$/.test(value)) return "projects"
    if (/^(education|academic background)$/.test(value)) return "education"
    if (/^(certifications?|licenses)$/.test(value)) return "certifications"
    return null
}

function splitLines(text) {
    return String(text || "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean)
}

function buildSections(lines) {
    const sections = []
    let current = { name: "other", lines: [] }
    for (const line of lines) {
        const name = sectionName(line)
        if (name) {
            current = { name, lines: [] }
            sections.push(current)
        } else current.lines.push(line)
    }
    return sections
}

function extractSkills(section, sourceType) {
    const result = []
    const seen = new Map()
    for (const line of section.lines) {
        const matches = findTechnologyMatches(line)
        for (const match of matches) {
            const item = evidence(match.originalText, match.normalizedName, match.category, sourceType, section.name, line, "explicit", sourceType === "summary" ? "medium" : "high")
            const existing = seen.get(match.normalizedName)
            if (existing) existing.evidence.push(item)
            else {
                const skill = { originalText: match.originalText, normalizedValue: match.normalizedName, category: match.category, evidence: [item] }
                seen.set(match.normalizedName, skill)
                result.push(skill)
            }
        }
        if (section.name === "skills") {
            const tokens = line.split(/[,;|]/).map(value => value.replace(/^[-*•]\s*/, "").trim()).filter(Boolean)
            for (const token of tokens) {
                if (findTechnologyMatches(token).length || token.length < 2 || /^(skills?|technologies?)$/i.test(token)) continue
                if (!/[a-z]/i.test(token) || !(/(js|sql|cloud|platform|framework|database|docker|api|lang)/i.test(token) || /^[A-Z][A-Za-z0-9.+#-]{2,}$/.test(token))) continue
                const key = normalize(token)
                if (!seen.has(key)) {
                    const item = evidence(token, token.replace(/\s+/g, " "), "other", "skillsSection", section.name, line, "explicit", "medium")
                    const skill = { originalText: token, normalizedValue: item.normalizedValue, category: "other", evidence: [item] }
                    seen.set(key, skill)
                    result.push(skill)
                }
            }
        }
    }
    return result
}

function parseDates(text) {
    const match = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4})\s*(?:-|–|—|to)\s*(Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4})/i)
    if (!match) return { originalText: null, start: null, end: null, isCurrent: null, status: "unknown" }
    const end = /present|current/i.test(match[2]) ? null : match[2]
    return { originalText: match[0], start: match[1], end, isCurrent: end === null, status: "explicit" }
}

function parseExperience(section) {
    const entries = []
    let current = null
    for (const line of section.lines) {
        const dates = parseDates(line)
        const isBullet = /^[-*•]/.test(line)
        if (dates.status === "explicit" && current) {
            current.dates = dates
        } else if (!isBullet && (dates.status === "explicit" || /\b(engineer|developer|manager|analyst|designer|consultant|intern|specialist|lead)\b/i.test(line))) {
            current = { lines: [line], dates }
            entries.push(current)
        } else if (current) current.lines.push(line)
    }
    return entries.map(entry => {
        const header = entry.lines[0].trim()
        const headerParts = header.split("|").map(value => value.trim()).filter(Boolean)
        const titleMatch = header.match(/\b(engineer|developer|manager|analyst|designer|consultant|intern|specialist|lead|architect|administrator)\b[^,|]*/i)
        const titleText = headerParts.length > 1 ? headerParts[0] : (titleMatch ? titleMatch[0].trim() : null)
        const companyText = headerParts.length > 1 ? headerParts[1] : null
        const bullets = entry.lines.slice(1).filter(line => /^[-*•]/.test(line)).map(line => line.replace(/^[-*•]\s*/, "").trim())
        const technologies = []
        for (const bullet of bullets) for (const match of findTechnologyMatches(bullet)) technologies.push(evidence(match.originalText, match.normalizedName, match.category, "professionalExperience", "experience", bullet, "explicit", "high"))
        const responsibilities = bullets.filter(text => !/\b(increased|reduced|grew|improved|delivered|achieved|saved|generated)\b/i.test(text)).map(text => evidence(text, text, "responsibility", "professionalExperience", "experience", text, "explicit", "medium"))
        const achievements = bullets.filter(text => /\b(increased|reduced|grew|improved|delivered|achieved|saved|generated)\b/i.test(text)).map(text => evidence(text, text, "achievement", "professionalExperience", "experience", text, "explicit", "medium"))
        return {
            title: titleText ? evidence(titleText, titleText, "jobTitle", "professionalExperience", "experience", entry.lines[0], "explicit", "medium") : null,
            company: companyText ? evidence(companyText, companyText, "company", "professionalExperience", "experience", entry.lines[0], "explicit", "medium") : null,
            dates: entry.dates,
            duration: { originalText: null, normalizedValue: null, category: "duration", sourceType: "professionalExperience", sourceSection: "experience", evidenceText: entry.lines[0], status: "unknown", confidence: "low" },
            responsibilities,
            achievements,
            technologies
        }
    })
}

function parseEducation(section) {
    const sectionInProgress = section.lines.some(line => /\b(?:expected|in progress|currently pursuing|ongoing|pursuing)\b/i.test(line))
    return section.lines.map(line => {
        const year = line.match(/\b(?:19|20)\d{2}\b/)
        const degree = line.match(/\b(bachelor(?:'s)?|master(?:'s)?|ph\.?d\.?|associate(?:'s)?|diploma|b\.?tech|m\.?tech)\b[^,|\n]*/i)
        if (!degree && !year) return null
        const institution = line.split(/,|\|| - /).map(v => v.trim()).find(v => /university|college|institute|school/i.test(v))
        const field = degree && /\b(?:in|of)\s+([A-Za-z][A-Za-z &/-]{2,})/i.exec(degree[0])
        const inProgress = sectionInProgress || /\b(?:expected|in progress|currently pursuing|ongoing|pursuing)\b/i.test(line)
        return { degree: degree ? evidence(degree[0], degree[0], "degree", "education", "education", line, "explicit", inProgress ? "medium" : "high") : null, fieldOfStudy: field ? evidence(field[1].trim(), field[1].trim(), "fieldOfStudy", "education", "education", line) : null, institution: institution ? evidence(institution, institution, "institution", "education", "education", line) : null, graduationYear: year ? evidence(year[0], year[0], "graduationYear", "education", "education", line) : null, completionStatus: inProgress ? "inProgress" : "unknown" }
    }).filter(Boolean)
}

function parseCertifications(section) {
    return section.lines.map(line => ({ name: evidence(line, line, "certification", "certification", "certifications", line), issuer: null, date: null }))
}

function extractResumeEvidence(resumeText = "") {
    const sections = buildSections(splitLines(resumeText))
    const skills = []
    for (const section of sections) {
        const sourceType = section.name === "skills" ? "skillsSection" : section.name === "projects" ? "project" : section.name === "experience" ? "professionalExperience" : section.name === "summary" ? "summary" : "other"
        if (["skills", "projects", "experience", "summary"].includes(section.name)) skills.push(...extractSkills(section, sourceType))
    }
    const mergedSkills = new Map()
    for (const skill of skills) {
        const existing = mergedSkills.get(skill.normalizedValue)
        if (existing) existing.evidence.push(...skill.evidence)
        else mergedSkills.set(skill.normalizedValue, skill)
    }
    const projectSections = sections.filter(section => section.name === "projects")
    const projects = projectSections.flatMap(section => section.lines.filter(line => !/^[-*•]/.test(line)).map(line => ({ name: evidence(line, line, "projectName", "project", "projects", line), description: null, technologies: extractSkills({ ...section, lines: [line] }, "project").flatMap(skill => skill.evidence) })))
    return {
        skills: [...mergedSkills.values()],
        professionalExperience: sections.filter(section => section.name === "experience").flatMap(parseExperience),
        projects,
        education: sections.filter(section => section.name === "education").flatMap(parseEducation),
        certifications: sections.filter(section => section.name === "certifications").flatMap(parseCertifications)
    }
}

module.exports = { extractResumeEvidence, SOURCE_TYPES, STATUS_VALUES, CONFIDENCE_VALUES }
