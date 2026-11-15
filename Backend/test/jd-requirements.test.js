const { test } = require("node:test")
const assert = require("node:assert/strict")
const { extractJdRequirements } = require("../src/services/jd-requirements.service")

function find(requirements, name) {
    return requirements.find(requirement => requirement.normalizedName === name)
}

test("normalizes common aliases and preserves evidence", () => {
    const { requirements } = extractJdRequirements("Required: JS, React.js, NodeJS, Postgres, and Amazon Web Services experience.")

    assert.equal(find(requirements, "JavaScript").category, "programmingLanguage")
    assert.equal(find(requirements, "React").originalText, "React.js")
    assert.equal(find(requirements, "Node.js").originalText, "NodeJS")
    assert.equal(find(requirements, "PostgreSQL").originalText, "Postgres")
    assert.equal(find(requirements, "AWS").originalText, "Amazon Web Services")
    assert.equal(find(requirements, "AWS").sourceEvidence, "Required: JS, React.js, NodeJS, Postgres, and Amazon Web Services experience.")
})

test("deduplicates aliases and keeps the strongest requirement type", () => {
    const { requirements } = extractJdRequirements("Requirements\nReact is preferred.\nReact.js is required.")
    const react = requirements.filter(requirement => requirement.normalizedName === "React")

    assert.equal(react.length, 1)
    assert.equal(react[0].requirementType, "required")
})

test("detects required, preferred, and unspecified requirements", () => {
    const { requirements } = extractJdRequirements("Experience with PostgreSQL.\nRequired Qualifications\nMust have Python.\nPreferred Qualifications\nDocker is nice to have.")

    assert.equal(find(requirements, "Python").requirementType, "required")
    assert.equal(find(requirements, "Docker").requirementType, "preferred")
    assert.equal(find(requirements, "PostgreSQL").requirementType, "unspecified")
})

test("extracts multiple categories", () => {
    const { requirements } = extractJdRequirements("Requirements\n5+ years of professional experience with Java and MongoDB. Bachelor's degree in Computer Science. AWS certification is preferred.")
    const categories = new Set(requirements.map(requirement => requirement.category))

    assert.equal(categories.has("experience"), true)
    assert.equal(categories.has("programmingLanguage"), true)
    assert.equal(categories.has("database"), true)
    assert.equal(categories.has("education"), true)
    assert.equal(categories.has("certification"), true)
})

test("returns no requirements for missing or empty descriptions", () => {
    assert.deepEqual(extractJdRequirements().requirements, [])
    assert.deepEqual(extractJdRequirements("   ").requirements, [])
    assert.deepEqual(extractJdRequirements(null).requirements, [])
})

test("does not treat company-description mentions as requirements", () => {
    const { requirements } = extractJdRequirements("About the company\nWe build our platform on AWS and React.\nRequirements\nExperience with Node.js is required.")

    assert.equal(find(requirements, "AWS"), undefined)
    assert.equal(find(requirements, "React"), undefined)
    assert.equal(find(requirements, "Node.js").requirementType, "required")
})

test("keeps similar technologies distinct", () => {
    const { requirements } = extractJdRequirements("Required: JavaScript, Java, React, and PostgreSQL. Preferred: React Native and PostGIS.")
    const names = requirements.map(requirement => requirement.normalizedName)

    assert.equal(names.includes("JavaScript"), true)
    assert.equal(names.includes("Java"), true)
    assert.equal(names.includes("React"), true)
    assert.equal(names.includes("React Native"), true)
    assert.equal(names.includes("PostgreSQL"), true)
    assert.equal(find(requirements, "PostGIS").category, "other")
})

test("does not fuzzy-convert unknown technologies", () => {
    const { requirements } = extractJdRequirements("Required: SvelteKit experience.")
    assert.equal(find(requirements, "SvelteKit").category, "other")
    assert.equal(find(requirements, "SvelteKit").normalizedName, "SvelteKit")
})

test("excludes standalone headings while extracting their requirements", () => {
    const { requirements } = extractJdRequirements("Required Skills & Qualifications\nJavaScript and React.js\nSkills (Nice to Have)\nDocker and TypeScript\nKey Responsibilities\nBuild production features.")
    assert.ok(requirements.some(item => item.normalizedName === "JavaScript"))
    assert.ok(requirements.some(item => item.normalizedName === "Docker"))
    assert.ok(!requirements.some(item => /skills|qualifications|responsibilities/i.test(item.originalText)))
})

test("handles preferred and required section transitions", () => {
    const { requirements } = extractJdRequirements("Preferred Qualifications\nDocker\nRequired Qualifications\nKubernetes\nRequirements\nPostgres")

    assert.equal(find(requirements, "Docker").requirementType, "preferred")
    assert.equal(find(requirements, "Kubernetes").requirementType, "required")
    assert.equal(find(requirements, "PostgreSQL").requirementType, "required")
})

test("extracts education and certification wording conservatively", () => {
    const { requirements } = extractJdRequirements("Education\nBachelor's degree in Computer Science or equivalent.\nCertifications\nAWS Certified Solutions Architect certification preferred.")
    const education = requirements.find(requirement => requirement.category === "education")
    const certification = requirements.find(requirement => requirement.category === "certification")

    assert.equal(education.originalText, "Bachelor's degree in Computer Science or equivalent")
    assert.equal(education.sourceEvidence, "Bachelor's degree in Computer Science or equivalent.")
    assert.equal(certification.requirementType, "preferred")
    assert.match(certification.originalText, /certified|certification/i)
})

test("does not match aliases inside distinct technology names", () => {
    const { requirements } = extractJdRequirements("Required: JavaScript, React Native, Node-RED, and PostGIS.")
    const names = requirements.map(requirement => requirement.normalizedName)

    assert.equal(names.includes("JavaScript"), true)
    assert.equal(names.includes("React Native"), true)
    assert.equal(names.includes("Java"), false)
    assert.equal(names.includes("React"), false)
    assert.equal(names.includes("Node.js"), false)
    assert.equal(names.includes("PostgreSQL"), false)
})

test("merges distinct evidence once and applies priority precedence", () => {
    const { requirements } = extractJdRequirements("Experience with React is mentioned.\nReact is preferred.\nReact.js is required.\nReact.js is required.")
    const react = find(requirements, "React")

    assert.equal(react.requirementType, "required")
    assert.equal(react.sourceEvidence.split("React.js is required.").length - 1, 1)
    assert.match(react.sourceEvidence, /Experience with React is mentioned\./)
    assert.match(react.sourceEvidence, /React is preferred\./)
    assert.match(react.sourceEvidence, /React\.js is required\./)
})

test("preserves original wording for unknown explicit requirements", () => {
    const { requirements } = extractJdRequirements("Must have: SvelteKit.")
    const requirement = find(requirements, "SvelteKit")

    assert.equal(requirement.originalText, "SvelteKit")
    assert.equal(requirement.normalizedName, "SvelteKit")
    assert.equal(requirement.sourceEvidence, "Must have: SvelteKit.")
})
