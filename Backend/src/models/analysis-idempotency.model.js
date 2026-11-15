const mongoose = require("mongoose")

const analysisIdempotencySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    key: { type: String, required: true },
    status: { type: String, enum: ["processing", "completed", "failed"], required: true },
    report: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewReport" },
    expiresAt: { type: Date, required: true }
}, { timestamps: true })

analysisIdempotencySchema.index({ user: 1, key: 1 }, { unique: true })
analysisIdempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model("AnalysisIdempotency", analysisIdempotencySchema)
