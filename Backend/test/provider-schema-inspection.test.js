const { test } = require("node:test")
const assert = require("node:assert/strict")
const { zodToJsonSchema } = require("zod-to-json-schema")

process.env.GOOGLE_GENAI_API_KEY = "provider-schema-inspection-test-key"

const {
    interviewReportSchema,
    analysisResponseSchemaForGemini,
    geminiResumeAnalysisProviderSchema
} = require("../src/services/ai.service")

const LEGACY_FIELDS = new Set([ "technicalQuestions", "behavioralQuestions", "skillGaps" ])
const SUSPICIOUS_KEYWORDS = new Set([
    "$ref",
    "$schema",
    "additionalProperties",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems"
])

function walkSchema(value, path = "", findings = []) {
    if (!value || typeof value !== "object") return findings

    if (Array.isArray(value)) {
        value.forEach((item, index) => walkSchema(item, `${path}[${index}]`, findings))
        return findings
    }

    for (const key of Object.keys(value)) {
        if (SUSPICIOUS_KEYWORDS.has(key)) findings.push({ path: path || "$", keyword: key })
    }

    if (value.type === "object" && value.properties) {
        const propertyNames = Object.keys(value.properties)
        for (const required of value.required || []) {
            if (!propertyNames.includes(required)) {
                findings.push({ path: path || "$", keyword: "required_without_property", field: required })
            }
        }
        for (const [name, child] of Object.entries(value.properties)) {
            walkSchema(child, path ? `${path}.${name}` : name, findings)
        }
    }

    if (value.items) walkSchema(value.items, `${path}[]`, findings)
    return findings
}

test("provider schema has no unresolved references and consistent object requirements", () => {
    const provider = analysisResponseSchemaForGemini()
    const findings = walkSchema(provider)

    assert.equal(findings.some(({ keyword }) => keyword === "$ref"), false)
    assert.equal(findings.some(({ keyword }) => keyword === "required_without_property"), false)
    assert.deepEqual(
        Object.keys(provider.properties).sort(),
        [
            "analysisVersion",
            "overallSummary",
            "categoryAssessments",
            "eligibility",
            "skillAssessments",
            "strengths",
            "areasOfImprovement",
            "resumeGaps",
            "experienceAlignment",
            "educationCertificationAnalysis",
            "toneStyleAnalysis",
            "title"
        ].sort()
    )

    console.log("Provider schema inspection:", JSON.stringify({
        topLevelProperties: Object.keys(provider.properties).length,
        requiredFields: provider.required.length,
        suspiciousKeywords: findings.filter(({ keyword }) => keyword !== "$ref" && keyword !== "required_without_property")
    }, null, 2))
})

test("provider schema preserves enums and array item structures", () => {
    const provider = analysisResponseSchemaForGemini()
    const skill = provider.properties.skillAssessments
    const item = skill.items

    assert.deepEqual(Object.keys(item.properties).sort(), [ "evidence", "explanation", "importance", "skill", "status" ])
    assert.deepEqual(item.required.sort(), [ "evidence", "explanation", "importance", "skill", "status" ])
    assert.deepEqual(item.properties.status.enum, [ "Matched", "Partial", "Missing", "Needs Verification" ])
    assert.deepEqual(item.properties.importance.enum, [ "Critical", "Required", "Preferred", "Bonus" ])
    assert.equal(skill.maxItems, undefined)
    assert.equal(skill.items.properties.evidence.maxItems, undefined)
})

test("provider schema matches the Zod-derived contract except approved legacy fields", () => {
    const original = zodToJsonSchema(interviewReportSchema, { $refStrategy: "none" })
    const provider = analysisResponseSchemaForGemini()

    for (const field of Object.keys(original.properties)) {
        if (LEGACY_FIELDS.has(field)) {
            assert.equal(provider.properties[field], undefined)
        } else {
            assert.ok(provider.properties[field], `Missing provider property: ${field}`)
        }
    }

    assert.equal(provider.required.includes("technicalQuestions"), false)
    assert.equal(provider.required.includes("behavioralQuestions"), false)
    assert.equal(provider.required.includes("skillGaps"), false)
})

test("qualitative provider schema contains exactly the approved six fields", () => {
    const provider = geminiResumeAnalysisProviderSchema()
    const fields = Object.keys(provider.properties).sort()

    assert.deepEqual(fields, [
        "areasOfImprovement",
        "educationCertificationAnalysis",
        "experienceAlignment",
        "overallSummary",
        "resumeQualityAnalysis",
        "strengths"
    ].sort())
    assert.deepEqual(provider.required.sort(), fields)
    assert.equal(provider.properties.strengths.items.type, "string")
    assert.equal(provider.properties.areasOfImprovement.items.type, "string")
    assert.equal(JSON.stringify(provider).includes("$ref"), false)
})
