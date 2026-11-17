const mongoose = require('mongoose')


const blacklistTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        select: false
    },
    tokenHash: {
        type: String,
        select: false
    },
    expiresAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
})

blacklistTokenSchema.pre("validate", function() {
    if (!this.token && !this.tokenHash) {
        this.invalidate("tokenHash", "a token hash or legacy token is required")
    }
})

blacklistTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const tokenBlacklistModel = mongoose.model("blacklistTokens", blacklistTokenSchema)


module.exports = tokenBlacklistModel
