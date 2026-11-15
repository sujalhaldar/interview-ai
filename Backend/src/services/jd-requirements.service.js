const dictionary = require("./jd-requirements.dictionary")

const REQUIREMENT_CUES = /\b(required|required qualification|required qualifications|must have|must possess|mandatory|need to have|proficient in|strong knowledge of|hands-on|experience with|experience in|familiarity with|knowledge of|skilled in)\b/i
const EXPLICIT_REQUIRED_CUES = /\b(required|required qualification|required qualifications|must have|must possess|mandatory|need to have)\b/i
const PREFERRED_CUES = /\b(preferred|preferably|nice to have|nice-to-have|bonus|plus|desired)\b/i
const REQUIREMENT_HEADERS = /\b(requirements?|qualifications?|technical skills?|required qualifications?|preferred qualifications?|nice to have|education|certifications?|experience)\b/i
const STANDALONE_HEADING = /^(?:required\s+)?(?:skills?(?:\s*&\s*qualifications?|\s*\(nice\s+to\s+have\))?|preferred\s+skills?(?:\s*\(?(?:nice\s+to\s+have)\)?|\s*&\s*qualifications?)?|key\s+responsibilities|core\s+stack|tools|requirements?|qualifications?|technical skills?|required qualifications?|preferred qualifications?|nice to have|education|certifications?|experience)\s*:?[.\- ]*$/i
const COMPANY_HEADERS = /\b(about us|about the company|our company|who we are|what we do|our mission|company overview)\b/i
const EXPERIENCE_PATTERN = /\b(?:at least\s+)?\d+(?:\+|\s*[-–]\s*\d+)?\s+years?\s+(?:of\s+)?(?:professional\s+)?(?:experience|work experience|industry experience)\b/i
const EDUCATION_PATTERN = /\b(?:bachelor(?:'s)?|master(?:'s)?|ph\.?d\.?|degree|diploma)\b[^.\n;]*(?:computer science|engineering|information technology|equivalent)?/i
const CERTIFICATION_PATTERN = /\b(?:certified|certification|certificate|certifications)\b[^.\n;]*/i

function normalizeText(value) {
    return value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim()
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const dictionaryEntries = dictionary
    .flatMap(entry => entry.aliases.map(alias => ({ ...entry, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)

function findAliasMatches(sentence) {
    const matches = dictionaryEntries.flatMap(entry => {
        const pattern = new RegExp(`(?<![a-z0-9+#])${escapeRegExp(normalizeText(entry.alias))}(?![a-z0-9+#])`, "i")
        const match = pattern.exec(sentence)
        return match ? [ { ...entry, originalText: match[0].trim(), start: match.index, end: match.index + match[0].length } ] : []
    })
    return matches.sort((a, b) => a.start - b.start || b.alias.length - a.alias.length).filter((match, index, all) => {
        const longerAtSameStart = all.some((other, otherIndex) => otherIndex < index && other.start === match.start && other.end > match.end)
        const isPrefixOfCompound = /^(react)$/i.test(match.normalizedName) && /\s+native\b/i.test(sentence.slice(match.end))
        return !longerAtSameStart && !isPrefixOfCompound && !all.some((other, otherIndex) => otherIndex < index && match.start < other.end && match.end > other.start)
    })
}

function requirementType(sentence, sectionType) {
    if (PREFERRED_CUES.test(sentence) || sectionType === "preferred") return "preferred"
    if (EXPLICIT_REQUIRED_CUES.test(sentence) || sectionType === "required") return "required"
    return "unspecified"
}

function sectionTypeFor(line) {
    if (/[.!?]/.test(line)) return null
    if (!REQUIREMENT_HEADERS.test(line)) return null
    if (/preferred|nice to have|bonus|desired|plus/i.test(line)) return "preferred"
    if (/key responsibilities|core stack|tools/i.test(line)) return "required"
    if (/required|mandatory|requirements?|qualifications?|technical skills?|experience|education|certifications?/i.test(line)) return "required"
    return "unspecified"
}

function isStandaloneHeading(line) {
    return STANDALONE_HEADING.test(line.trim())
}

function isRequirementContext(sentence, sectionType, isCompanySection) {
    if (isCompanySection && !REQUIREMENT_CUES.test(sentence) && !REQUIREMENT_HEADERS.test(sentence)) return false
    return Boolean(sectionType) || REQUIREMENT_CUES.test(sentence) || PREFERRED_CUES.test(sentence) || EXPERIENCE_PATTERN.test(sentence) || EDUCATION_PATTERN.test(sentence) || CERTIFICATION_PATTERN.test(sentence)
}

function addRequirement(results, seen, requirement) {
    const key = `${requirement.category}:${requirement.normalizedName}`
    const existing = seen.get(key)
    if (!existing) {
        seen.set(key, requirement)
        results.push(requirement)
        return
    }

    if (existing.requirementType === "unspecified" && requirement.requirementType !== "unspecified") existing.requirementType = requirement.requirementType
    if (existing.requirementType === "preferred" && requirement.requirementType === "required") existing.requirementType = "required"
    if (requirement.sourceEvidence !== existing.sourceEvidence && !existing.sourceEvidence.includes(requirement.sourceEvidence)) existing.sourceEvidence = `${existing.sourceEvidence}; ${requirement.sourceEvidence}`
}

function extractUnknownExplicit(sentence, type, knownNames) {
    const explicit = /\b(?:required|must have|must possess|mandatory|preferred|preferably|nice to have|bonus|plus|desired)\b\s*:?[\s-]*(.+)$/i.exec(sentence)
    if (!explicit) return null
    const candidates = explicit[1].split(/\s+and\s+|,/i).map(value => value.trim().replace(/[,:;.]+$/, "").replace(/\s+(?:experience|knowledge|familiarity|skills?|proficiency)$/i, "")).filter(Boolean)
    const candidate = candidates.find(value => !/^(experience|knowledge|familiarity|skills?|ability|proficiency)$/i.test(value) && !knownNames.has(value.toLowerCase()) && !dictionaryEntries.some(entry => normalizeText(entry.alias) === normalizeText(value)))
    if (!candidate) return null
    return {
        originalText: candidate,
        normalizedName: candidate.replace(/\s+/g, " "),
        category: "other",
        requirementType: type,
        sourceEvidence: sentence.trim()
    }
}

function extractJdRequirements(jobDescription = "") {
    if (typeof jobDescription !== "string" || !jobDescription.trim()) return { requirements: [] }

    const lines = jobDescription.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean)
    const results = []
    const seen = new Map()
    let sectionType = null
    let isCompanySection = false

    for (const line of lines) {
        const nextSection = sectionTypeFor(line)
        if (nextSection !== null) sectionType = nextSection
        if (COMPANY_HEADERS.test(line)) isCompanySection = true
        if (nextSection !== null || REQUIREMENT_HEADERS.test(line)) isCompanySection = false

        const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean)
        for (const sentence of sentences) {
            if (isStandaloneHeading(sentence)) continue
            if (!isRequirementContext(sentence, sectionType, isCompanySection)) continue
            const type = requirementType(sentence, sectionType)
            const matches = findAliasMatches(sentence)
            const knownNames = new Set(matches.map(match => match.normalizedName.toLowerCase()))
            for (const match of matches) {
                addRequirement(results, seen, {
                    originalText: match.originalText,
                    normalizedName: match.normalizedName,
                    category: match.category,
                    requirementType: type,
                    sourceEvidence: sentence.trim()
                })
            }

            const unknown = extractUnknownExplicit(sentence, type, knownNames)
            if (unknown) addRequirement(results, seen, unknown)

            const experience = sentence.match(EXPERIENCE_PATTERN)
            if (experience) addRequirement(results, seen, {
                originalText: experience[0],
                normalizedName: experience[0].replace(/\s+/g, " ").trim(),
                category: "experience",
                requirementType: type,
                sourceEvidence: sentence.trim()
            })

            const education = sentence.match(EDUCATION_PATTERN)
            if (education) addRequirement(results, seen, {
                originalText: education[0],
                normalizedName: education[0].replace(/\s+/g, " ").trim(),
                category: "education",
                requirementType: type,
                sourceEvidence: sentence.trim()
            })

            const certification = sentence.match(CERTIFICATION_PATTERN)
            if (certification) addRequirement(results, seen, {
                originalText: certification[0],
                normalizedName: certification[0].replace(/\s+/g, " ").trim(),
                category: "certification",
                requirementType: type,
                sourceEvidence: sentence.trim()
            })
        }
    }

    return { requirements: results }
}

module.exports = { extractJdRequirements }
