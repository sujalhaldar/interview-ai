const dictionary = require("./jd-requirements.dictionary")
const STATUS_VALUES = ["matched", "partial", "missing", "needsVerification"]

function evidenceText(item) {
    return item && typeof item.evidenceText === "string" ? item.evidenceText : ""
}

function allResumeEvidence(resumeEvidence = {}) {
    const result = []
    for (const skill of resumeEvidence.skills || []) result.push(...(skill.evidence || []))
    for (const role of resumeEvidence.professionalExperience || []) {
        result.push(...[role.title, role.company].filter(Boolean))
        result.push(...(role.technologies || []), ...(role.responsibilities || []), ...(role.achievements || []))
    }
    for (const project of resumeEvidence.projects || []) result.push(project.name, project.description, ...(project.technologies || []))
    for (const education of resumeEvidence.education || []) result.push(education.degree, education.fieldOfStudy, education.institution, education.graduationYear)
    for (const certification of resumeEvidence.certifications || []) result.push(certification.name, certification.issuer, certification.date)
    return result.filter(Boolean)
}

function normalized(value) { return String(value || "").toLowerCase().replace(/[.\-_\s]/g, "") }

function canonicalNames(value) {
    const entry = dictionary.find(item => item.normalizedName === value)
    return new Set([value, ...(entry ? entry.aliases : [])].map(normalized))
}

function directTechnologyMatches(requirement, resumeEvidence) {
    const names = canonicalNames(requirement.normalizedName)
    const matches = allResumeEvidence(resumeEvidence).filter(item => item.normalizedValue && names.has(normalized(item.normalizedValue)))
    return matches
}

function categoryEvidence(requirement, resumeEvidence) {
    const matches = directTechnologyMatches(requirement, resumeEvidence)
    if (requirement.category === "certification") return (resumeEvidence.certifications || []).flatMap(item => [item.name, item.issuer, item.date].filter(Boolean)).filter(item => normalized(item.normalizedValue || item.originalText).includes(normalized(requirement.normalizedName)))
    if (requirement.category === "education") return (resumeEvidence.education || []).flatMap(item => [item.degree, item.fieldOfStudy, item.institution, item.graduationYear].filter(Boolean)).filter(item => normalized(item.normalizedValue || item.originalText).includes(normalized(requirement.normalizedName)))
    return matches
}

function sourceSummary(items) {
    return items.map(item => `${item.sourceType}: ${evidenceText(item) || item.originalText || item.normalizedValue}`).join("; ")
}

function classify(requirement, resumeEvidence) {
    const matches = categoryEvidence(requirement, resumeEvidence)
    if (["programmingLanguage", "frameworkOrLibrary", "toolOrPlatform", "database", "other"].includes(requirement.category)) {
        if (!matches.length) return { status: "missing", matchedEvidence: [], explanation: "No explicit resume evidence was found for this requirement." }
        const durationRequired = /\b\d+\+?\s+years?\b/i.test(requirement.originalText || requirement.normalizedName)
        if (durationRequired) {
            const professional = matches.filter(item => item.sourceType === "professionalExperience")
            if (professional.length) return { status: "partial", matchedEvidence: matches, explanation: "The technology is evidenced in professional work, but the required duration is not established." }
            return { status: "partial", matchedEvidence: matches, explanation: "The technology is present, but the required professional duration is not established." }
        }
        return { status: "matched", matchedEvidence: matches, explanation: "The normalized requirement is explicitly evidenced in the resume." }
    }
    if (requirement.category === "experience") return matchExperience(requirement, resumeEvidence)
    if (requirement.category === "education") return matchQualification(requirement, resumeEvidence.education || [], "education")
    if (requirement.category === "certification") return matchQualification(requirement, resumeEvidence.certifications || [], "certification")
    return matches.length ? { status: "matched", matchedEvidence: matches, explanation: "Relevant explicit evidence was found." } : { status: "missing", matchedEvidence: [], explanation: "No relevant explicit evidence was found." }
}

function parseYears(text) {
    const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*\+?\s*years?/i)
    return match ? Number(match[1]) : null
}

function dateValue(value) {
    if (!value) return null
    const match = String(value).match(/(\d{4})/)
    return match ? Number(match[1]) : null
}

function matchExperience(requirement, resumeEvidence) {
    const requiredYears = parseYears(requirement.originalText)
    const roles = resumeEvidence.professionalExperience || []
    const names = canonicalNames(requirement.normalizedName)
    const relevant = roles.filter(role => (role.technologies || []).some(item => names.has(normalized(item.normalizedValue))) || [...(role.responsibilities || []), ...(role.achievements || [])].some(item => names.has(normalized(requirement.normalizedName)) && evidenceText(item).toLowerCase().includes(String(requirement.normalizedName).toLowerCase())))
    const nonProfessional = allResumeEvidence(resumeEvidence).filter(item => names.has(normalized(item.normalizedValue)) && item.sourceType !== "professionalExperience")
    if (!relevant.length && nonProfessional.length) return { status: "partial", matchedEvidence: nonProfessional, explanation: "Relevant technology evidence exists, but it is not professional employment evidence." }
    if (!relevant.length) return { status: "missing", matchedEvidence: [], explanation: "No relevant professional experience evidence was found." }
    const evidence = relevant.flatMap(role => [...(role.technologies || []), ...(role.responsibilities || []), ...(role.achievements || [])])
    if (!requiredYears) return { status: "matched", matchedEvidence: evidence, explanation: "Relevant professional experience is explicitly evidenced." }
    const stated = roles.flatMap(role => [...(role.responsibilities || []), ...(role.achievements || [])]).find(item => parseYears(evidenceText(item)))
    if (stated && parseYears(evidenceText(stated)) >= requiredYears) return { status: "matched", matchedEvidence: [stated, ...evidence], explanation: "The required duration is explicitly self-reported; it is not independently verified." }
    const completeDates = relevant.filter(role => role.dates && role.dates.status === "explicit" && role.dates.start && role.dates.end)
    if (!completeDates.length) return { status: "needsVerification", matchedEvidence: evidence, explanation: "Relevant professional evidence exists, but dates or duration are incomplete." }
    const years = completeDates.reduce((total, role) => total + Math.max(0, (dateValue(role.dates.end) - dateValue(role.dates.start))), 0)
    if (years >= requiredYears) return { status: "matched", matchedEvidence: evidence, explanation: "Explicit non-overlapping employment dates support the required duration." }
    return { status: "partial", matchedEvidence: evidence, explanation: "Relevant professional experience exists, but the required duration is not established." }
}

function matchQualification(requirement, entries, type) {
    const target = normalized(requirement.normalizedName)
    const targetWords = String(requirement.normalizedName || requirement.originalText || "").toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !["the", "and", "degree", "with"].includes(word))
    const matches = entries.flatMap(entry => Object.values(entry).filter(value => {
        if (!value || typeof value !== "object") return false
        const candidate = normalized(value.normalizedValue || value.originalText)
        if (candidate === target || candidate.includes(target) || target.includes(candidate)) return true
        return type === "education" && targetWords.length > 0 && targetWords.filter(word => candidate.includes(word)).length >= Math.min(2, targetWords.length)
    }))
    if (type === "education" && entries.some(entry => entry.completionStatus === "inProgress") && matches.length) return { status: "partial", matchedEvidence: matches, explanation: "A relevant qualification is explicitly documented as in progress; completion is not established." }
    if (!matches.length) {
        const ambiguous = entries.flatMap(entry => Object.values(entry).filter(value => value && typeof value === "object" && value.status === "ambiguous"))
        return ambiguous.length ? { status: "needsVerification", matchedEvidence: ambiguous, explanation: `The ${type} evidence is ambiguous and requires verification.` } : { status: "missing", matchedEvidence: [], explanation: `No matching ${type} evidence was found.` }
    }
    return { status: "matched", matchedEvidence: matches, explanation: `The ${type} requirement is explicitly evidenced.` }
}

function matchJdRequirements(jdResult = {}, resumeEvidence = {}) {
    const requirements = jdResult.requirements || []
    const results = requirements.map(requirement => {
        const result = classify(requirement, resumeEvidence)
        return { ...requirement, status: result.status, matchedEvidence: result.matchedEvidence, explanation: result.explanation }
    })
    const summary = { total: results.length, matched: 0, partial: 0, missing: 0, needsVerification: 0 }
    for (const result of results) summary[result.status] += 1
    return { requirements: results, summary }
}

module.exports = { matchJdRequirements, STATUS_VALUES }
