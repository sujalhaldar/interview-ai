import test from 'node:test'
import assert from 'node:assert/strict'
import { getInterviewLayoutMode, INTERVIEW_LAYOUT_BREAKPOINTS, observeInterviewPageWidth } from '../src/features/interview/layout-mode.js'

test('maps measured workspace widths to the responsive interview layout modes', () => {
    assert.equal(getInterviewLayoutMode(INTERVIEW_LAYOUT_BREAKPOINTS.mobile - 1), 'mobile')
    assert.equal(getInterviewLayoutMode(INTERVIEW_LAYOUT_BREAKPOINTS.mobile), 'compact')
    assert.equal(getInterviewLayoutMode(INTERVIEW_LAYOUT_BREAKPOINTS.compact - 1), 'compact')
    assert.equal(getInterviewLayoutMode(INTERVIEW_LAYOUT_BREAKPOINTS.compact), 'full')
})

test('uses full mode only as a safe pre-measurement fallback', () => {
    assert.equal(getInterviewLayoutMode(null), 'full')
    assert.equal(getInterviewLayoutMode(undefined), 'full')
})

class TestResizeObserver {
    static instances = []

    constructor(callback) {
        this.callback = callback
        this.observed = []
        this.disconnected = false
        TestResizeObserver.instances.push(this)
    }

    observe(element) { this.observed.push(element) }
    disconnect() { this.disconnected = true }
    measure(width) { this.callback([{ contentRect: { width } }]) }
}

test('attaches the observer when the report page element is available', () => {
    TestResizeObserver.instances = []
    const page = { getBoundingClientRect: () => ({ width: 1024 }) }
    const onWidth = () => {}

    assert.equal(observeInterviewPageWidth(null, onWidth, TestResizeObserver), undefined)
    assert.equal(TestResizeObserver.instances.length, 0)

    const cleanup = observeInterviewPageWidth(page, onWidth, TestResizeObserver)
    assert.equal(TestResizeObserver.instances.length, 1)
    assert.deepEqual(TestResizeObserver.instances[0].observed, [page])
    assert.equal(typeof cleanup, 'function')
})

test('disconnects the observer when its lifecycle is cleaned up', () => {
    TestResizeObserver.instances = []
    const cleanup = observeInterviewPageWidth({ getBoundingClientRect: () => ({ width: 1024 }) }, () => {}, TestResizeObserver)

    cleanup()

    assert.equal(TestResizeObserver.instances[0].disconnected, true)
})

test('reinitializes observation when report availability changes', () => {
    TestResizeObserver.instances = []
    const onWidth = () => {}
    const noReportCleanup = observeInterviewPageWidth(null, onWidth, TestResizeObserver)
    assert.equal(TestResizeObserver.instances.length, 0)

    const firstPage = { getBoundingClientRect: () => ({ width: 1024 }) }
    const firstCleanup = observeInterviewPageWidth(firstPage, onWidth, TestResizeObserver)
    const secondPage = { getBoundingClientRect: () => ({ width: 900 }) }
    firstCleanup()
    observeInterviewPageWidth(secondPage, onWidth, TestResizeObserver)

    assert.equal(TestResizeObserver.instances.length, 2)
    assert.equal(TestResizeObserver.instances[0].disconnected, true)
    assert.deepEqual(TestResizeObserver.instances[1].observed, [secondPage])
    assert.equal(noReportCleanup, undefined)
})

test('ignores repeated rounded measurements', () => {
    TestResizeObserver.instances = []
    const widths = []
    const cleanup = observeInterviewPageWidth({ getBoundingClientRect: () => ({ width: 1024.2 }) }, width => widths.push(width), TestResizeObserver)
    const observer = TestResizeObserver.instances[0]

    observer.measure(1024.4)
    observer.measure(1023.6)
    observer.measure(900)
    observer.measure(900)

    assert.deepEqual(widths, [1024, 900])
    cleanup()
})
