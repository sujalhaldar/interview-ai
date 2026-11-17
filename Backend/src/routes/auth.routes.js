const { Router } = require('express')
const authController = require("../controllers/auth.controller")
const authMiddleware = require("../middlewares/auth.middleware")
const { csrfOrigin } = require("../middlewares/csrf.middleware")
const { googleAuthRateLimit } = require("../middlewares/rate-limit.middleware")

const authRouter = Router()

authRouter.post("/google", googleAuthRateLimit, authController.googleUserController)


/**
 * @route POST /api/auth/logout
 * @description clear token from user cookie and add the token in blacklist
 * @access public
 */
authRouter.post("/logout", csrfOrigin, authController.logoutUserController)


/**
 * @route GET /api/auth/get-me
 * @description get the current logged in user details
 * @access private
 */
authRouter.get("/get-me", authMiddleware.authUser, authController.getMeController)


module.exports = authRouter
