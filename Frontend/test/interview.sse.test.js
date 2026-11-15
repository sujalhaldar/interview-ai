import test from "node:test"
import assert from "node:assert/strict"
import { createSseParser } from "../src/features/interview/services/interview.sse.js"

test("parses events split across chunks and preserves ordering", () => {
    const seen = []
    const parser = createSseParser({ onProgress: value => seen.push(value.stage) })
    parser.consume("event: progress\ndata: {\"stage\":\"resume\"}\r")
    parser.consume("\n\r\nevent: complete\ndata: {\"interviewReport\":{\"_id\":\"r1\"}}\n\n")
    assert.deepEqual(seen, ["resume"])
    assert.deepEqual(parser.finish(), { _id: "r1" })
})

test("parses multiple events and ignores malformed or unknown events", () => {
    const seen = []
    const errors = []
    const parser = createSseParser({ onProgress: value => seen.push(value.stage), onError: value => errors.push(value.code) })
    parser.consume("event: unknown\ndata: {}\n\nevent: progress\ndata: not-json\n\nevent: progress\ndata: {\"stage\":\"role\"}\n\nevent: error\ndata: {\"code\":\"failed\"}\n\n")
    assert.deepEqual(seen, ["role"])
    assert.deepEqual(errors, ["failed"])
    assert.equal(parser.finish(), null)
})

test("does not treat an incomplete stream as complete", () => {
    const parser = createSseParser({})
    parser.consume("event: progress\ndata: {\"stage\":\"resume\"}")
    assert.equal(parser.finish(), null)
})
