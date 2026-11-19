import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { logout, getMe, googleLogin } from "./services/auth.api";
import { setExpectedUserId } from "./session.identity";

const AUTH_EVENT_KEY = 'resume-analysis-auth-change'

const broadcastAuthChange = (userId) => {
    const event = { userId: userId || null, nonce: `${Date.now()}-${Math.random()}` }
    try { window.localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(event)) } catch { /* storage may be unavailable */ }
}

export const AuthContext = createContext()

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const transitionGeneration = useRef(0)
    const initializationStarted = useRef(false)
    const mountedRef = useRef(false)
    const currentUserIdRef = useRef(null)
    const googleLoginInFlight = useRef(false)

    currentUserIdRef.current = user?.id || null

    const beginTransition = useCallback(() => {
        transitionGeneration.current += 1
        return transitionGeneration.current
    }, [])

    const isCurrentTransition = useCallback(generation => generation === transitionGeneration.current, [])

    const resolveCurrentUser = useCallback(async generation => {
        try {
            const data = await getMe()
            if (!mountedRef.current || !isCurrentTransition(generation)) return
            if (data?.user) {
                setExpectedUserId(data.user.id)
                setUser(data.user)
            }
        } catch {
            if (!mountedRef.current || !isCurrentTransition(generation)) return
            setExpectedUserId(null)
            setUser(null)
        } finally {
            if (mountedRef.current && isCurrentTransition(generation)) setLoading(false)
        }
    }, [isCurrentTransition])

    const revalidateCurrentUser = useCallback(announcedUserId => {
        const generation = beginTransition()
        const nextUserId = announcedUserId || null
        if (currentUserIdRef.current !== nextUserId) {
            setExpectedUserId(null)
            setUser(null)
        }
        return resolveCurrentUser(generation)
    }, [beginTransition, resolveCurrentUser])

    const handleGoogleLogin = useCallback(async idToken => {
        if (googleLoginInFlight.current) return { success: false, error: { code: "AUTH_IN_PROGRESS" } }
        googleLoginInFlight.current = true
        const generation = beginTransition()
        setLoading(true)
        try {
            const data = await googleLogin(idToken)
            if (!isCurrentTransition(generation)) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            setUser(data.user)
            setExpectedUserId(data.user.id)
            broadcastAuthChange(data.user.id)
            return { success: true, user: data.user }
        } catch (err) {
            if (!isCurrentTransition(generation)) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            return { success: false, error: err }
        } finally {
            if (isCurrentTransition(generation)) setLoading(false)
            googleLoginInFlight.current = false
        }
    }, [beginTransition, isCurrentTransition])

    const handleLogout = useCallback(async () => {
        const generation = beginTransition()
        setLoading(true)
        try {
            await logout()
            if (!isCurrentTransition(generation)) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            setUser(null)
            setExpectedUserId(null)
            broadcastAuthChange(null)
            return { success: true }
        } catch (err) {
            if (!isCurrentTransition(generation)) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            return { success: false, error: err }
        } finally {
            if (isCurrentTransition(generation)) setLoading(false)
        }
    }, [beginTransition, isCurrentTransition])

    useEffect(() => {
        mountedRef.current = true
        const handleIdentitySignal = event => {
            const announcedUserId = event?.detail?.userId ?? event?.userId ?? null
            void revalidateCurrentUser(announcedUserId)
        }
        const onStorage = event => {
            if (event.key !== AUTH_EVENT_KEY) return
            try { handleIdentitySignal(JSON.parse(event.newValue || '{}')) } catch { handleIdentitySignal({ userId: null }) }
        }

        window.addEventListener(AUTH_EVENT_KEY, handleIdentitySignal)
        window.addEventListener('storage', onStorage)

        if (!initializationStarted.current) {
            initializationStarted.current = true
            void revalidateCurrentUser(null)
        }

        return () => {
            mountedRef.current = false
            window.removeEventListener(AUTH_EVENT_KEY, handleIdentitySignal)
            window.removeEventListener('storage', onStorage)
        }
    }, [revalidateCurrentUser])

    return (
        <AuthContext.Provider value={{ user, setUser, loading, setLoading, beginTransition, isCurrentTransition, revalidateCurrentUser, handleGoogleLogin, handleLogout }}>
            {children}
        </AuthContext.Provider>
    )
}
