const userModel = require("../models/user.model")
const jwt = require("jsonwebtoken")
const tokenBlacklistModel = require("../models/blacklist.model")
const googleAuthService = require("../services/google-auth.service")

function authenticatedUserResponse(user) {
    return { id: user._id, username: user.username, email: user.email }
}

function issueApplicationSession(res, user) {
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "1d" })
    res.cookie("token", token)
}

async function googleUserController(req, res) {
    const idToken = req.body?.idToken
    if (typeof idToken !== "string" || !idToken.trim()) return res.status(400).json({ message: "Google authentication token is required." })

    let googleIdentity
    try {
        googleIdentity = await googleAuthService.verifyGoogleIdToken(idToken)
    } catch {
        return res.status(401).json({ message: "Google authentication failed." })
    }

    const email = googleIdentity.email.trim().toLowerCase()
    let user = await userModel.findOne({ googleSub: googleIdentity.sub })
    if (!user) {
        const emailOwner = await userModel.findOne({ email })
        if (emailOwner && !emailOwner.googleSub) return res.status(409).json({ message: "This email is already linked to an existing account." })
        if (emailOwner && emailOwner.googleSub !== googleIdentity.sub) return res.status(409).json({ message: "This Google account is linked to a different account." })

        const baseUsername = (googleIdentity.name || email.split("@")[0] || "google-user").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "google-user"
        try {
            user = await userModel.create({ username: `${baseUsername}-${googleIdentity.sub.slice(-8)}`, email, googleSub: googleIdentity.sub, profilePicture: googleIdentity.picture })
        } catch (error) {
            const concurrentUser = await userModel.findOne({ googleSub: googleIdentity.sub })
            if (!concurrentUser) throw error
            user = concurrentUser
        }
    }

    issueApplicationSession(res, user)
    return res.status(200).json({ message: "Google authentication successful.", user: authenticatedUserResponse(user) })
}

/**
 * @name logoutUserController
 * @description clear token from user cookie and add the token in blacklist
 * @access public
 */
async function logoutUserController(req, res) {
    const token = req.cookies.token

    if (token) {
        await tokenBlacklistModel.create({ token })
    }

    res.clearCookie("token")

    res.status(200).json({
        message: "User logged out successfully"
    })
}

/**
 * @name getMeController
 * @description get the current logged in user details.
 * @access private
 */
async function getMeController(req, res) {

    const user = await userModel.findById(req.user.id)



    res.status(200).json({
        message: "User details fetched successfully",
        user: {
            id: user._id,
            username: user.username,
            email: user.email
        }
    })

}



module.exports = {
    logoutUserController,
    getMeController,
    googleUserController
}
