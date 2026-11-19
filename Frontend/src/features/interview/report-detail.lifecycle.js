export const isReportIdentityReady = ({ authLoading, userId, readyUserId }) =>
    !authLoading && Boolean(userId) && userId === readyUserId

export const reportLoadErrorKind = (error) => {
    const status = error?.response?.status
    if (status === 404) return 'not-found'
    if (status === 401 || error?.code === 'AUTH_TRANSITION') return 'unauthorized'
    return 'unavailable'
}

export const runReportDetailRequest = async ({ load, markOpened, isCurrent, onSuccess, onError, onSettled }) => {
    try {
        const report = await load()
        if (!isCurrent()) return null
        if (!report) {
            onError('not-found')
            return null
        }
        onSuccess(report)
        void Promise.resolve().then(() => isCurrent() ? markOpened() : undefined).catch(() => { /* opening metadata is best effort */ })
        return report
    } catch (error) {
        if (isCurrent()) onError(reportLoadErrorKind(error))
        return null
    } finally {
        if (isCurrent()) onSettled()
    }
}
