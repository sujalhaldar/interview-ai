const express = require("express")
const cookieParser = require("cookie-parser")
const cors = require("cors")
const { getAllowedCsrfOrigins, normalizeOrigin } = require("./config/auth.config")
const apiErrorHandler = require("./middlewares/api-error.middleware")

const app = express()

app.disable("x-powered-by")
app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer"
    })
    next()
})
app.use(express.json())
app.use(cookieParser())
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true)
        let normalizedOrigin = null
        try {
            normalizedOrigin = normalizeOrigin(origin)
        } catch {
            return callback(null, false)
        }
        callback(null, getAllowedCsrfOrigins().includes(normalizedOrigin))
    },
    credentials: true
}))

/* require all the routes here */
const authRouter = require("./routes/auth.routes")
const interviewRouter = require("./routes/interview.routes")


/* using all the routes here */
app.use("/api/auth", authRouter)
app.use("/api/interview", interviewRouter)

app.use(apiErrorHandler)


module.exports = app
