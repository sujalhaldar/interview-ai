const test = require("node:test")
const assert = require("node:assert/strict")
process.env.GEMINI_API_KEY = "test-only-key"
const { normalizeConfirmedSkills, addConfirmedEvidence } = require("../src/controllers/interview.controller")

test("normalizes aliases and removes duplicate confirmed skills", () => {
    const skills = normalizeConfirmedSkills(["JS", "JavaScript", "Docker"])
    assert.deepEqual(skills.map(item => item.normalizedName), ["JavaScript", "Docker"])
    assert.equal(skills[0].sourceType, "userConfirmed")
    assert.equal(skills[0].confidence, "userConfirmed")
})

test("adds user-confirmed evidence without replacing original resume evidence", () => {
    const original = { skills: [{ normalizedValue: "Docker", evidence: [{ sourceType: "skillsSection", evidenceText: "Docker" }] }] }
    const updated = addConfirmedEvidence(original, normalizeConfirmedSkills(["Docker", "Postgres"]))
    assert.equal(updated.skills[0].evidence.length, 2)
    assert.equal(updated.skills[0].evidence[1].sourceType, "userConfirmed")
    assert.equal(original.skills[0].evidence.length, 1)
    assert.equal(updated.skills[1].normalizedValue, "PostgreSQL")
})

test("rejects malformed confirmed skill input", () => {
    assert.throws(() => normalizeConfirmedSkills("Docker"), /Invalid confirmed skills/)
    assert.throws(() => normalizeConfirmedSkills([""]), /Invalid confirmed skills/)
})
