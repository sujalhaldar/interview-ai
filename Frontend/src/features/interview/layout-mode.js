export const INTERVIEW_LAYOUT_BREAKPOINTS = Object.freeze({
    mobile: 900,
    compact: 1120,
})

export function getInterviewLayoutMode(width) {
    if (typeof width !== 'number' || !Number.isFinite(width)) return 'full'
    if (width < INTERVIEW_LAYOUT_BREAKPOINTS.mobile) return 'mobile'
    if (width < INTERVIEW_LAYOUT_BREAKPOINTS.compact) return 'compact'
    return 'full'
}

export function observeInterviewPageWidth(page, onWidth, ResizeObserverImpl = globalThis.ResizeObserver) {
    if (!page) return undefined

    let previousWidth
    const updateWidth = (width) => {
        const measuredWidth = Math.round(width)
        if (measuredWidth === previousWidth) return
        previousWidth = measuredWidth
        onWidth(measuredWidth)
    }

    updateWidth(page.getBoundingClientRect().width)
    if (typeof ResizeObserverImpl !== 'function') return undefined

    const observer = new ResizeObserverImpl(([entry]) => updateWidth(entry.contentRect.width))
    observer.observe(page)
    return () => observer.disconnect()
}
