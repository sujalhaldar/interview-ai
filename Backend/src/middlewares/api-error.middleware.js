function apiErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error)

    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500
    const message = status < 500 ? "Request could not be processed." : "Internal server error."
    console.error("Unhandled API request failure", { status, errorName: error?.name || "Error" })
    return res.status(status).json({ message })
}

module.exports = apiErrorHandler
