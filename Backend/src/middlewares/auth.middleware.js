const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")
const tokenBlacklistModel = require("../models/blacklist.model")



async function authUser(req, res, next) {

    const token = req.cookies.token

    if (!token) {
        return res.status(401).json({
            message: "Token not provided."
        })
    }

    const isTokenBlacklisted = await tokenBlacklistModel.findOne({
        token
    })

    if (isTokenBlacklisted) {
        return res.status(401).json({
            message: "token is invalid"
        })
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        if (req.baseUrl === "/api/interview") {
            const expectedUserId = req.get("X-Expected-User-Id")
            const jwtUserId = String(decoded.id)
            const malformed = typeof expectedUserId !== "string" || !expectedUserId.trim() || /\s/.test(expectedUserId) || (mongoose.Types.ObjectId.isValid(jwtUserId) && !mongoose.Types.ObjectId.isValid(expectedUserId))
            if (malformed) {
                return res.status(409).json({ message: "Authentication session changed. Please retry." })
            }
            if (expectedUserId !== jwtUserId) {
                return res.status(409).json({ message: "Authentication session changed. Please retry." })
            }
        }

        req.user = decoded

        next()

    } catch (err) {

        return res.status(401).json({
            message: "Invalid token."
        })
    }

}


module.exports = { authUser }
