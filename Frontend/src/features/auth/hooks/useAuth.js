import { useCallback, useContext, useEffect, useRef } from "react";
import { AuthContext } from "../auth.context";
import { logout, getMe, googleLogin } from "../services/auth.api";
import { setExpectedUserId } from "../session.identity";

const AUTH_EVENT_KEY = 'resume-analysis-auth-change'
const broadcastAuthChange = (userId) => {
    const event = { userId: userId || null, nonce: `${Date.now()}-${Math.random()}` }
    try { window.localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(event)) } catch { /* storage may be unavailable */ }
}


export const useAuth = () => {

    const context = useContext(AuthContext)
    const { user, setUser, loading, setLoading, beginTransition, isCurrentTransition } = context
    const googleLoginInFlight = useRef(false)

    const resolveCurrentUser = useCallback(async (generation) => {
        try {
            const data = await getMe()
            if (!isCurrentTransition(generation)) return
            if (data?.user) { setExpectedUserId(data.user.id); setUser(data.user) }
        } catch {
            if (!isCurrentTransition(generation)) return
            setExpectedUserId(null); setUser(null)
        } finally {
            if (isCurrentTransition(generation)) setLoading(false)
        }
    }, [isCurrentTransition, setLoading, setUser])


    const handleGoogleLogin = useCallback(async (idToken) => {
        if (googleLoginInFlight.current) return { success: false, error: { code: "AUTH_IN_PROGRESS" } }
        googleLoginInFlight.current = true
        const generation = beginTransition()
        setLoading(true)
        try {
            const data = await googleLogin(idToken)
            if (!isCurrentTransition(generation)) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            setUser(data.user); setExpectedUserId(data.user.id); broadcastAuthChange(data.user.id)
            return { success: true, user: data.user }
        } catch (err) {
            if (!isCurrentTransition(generation)) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            return { success: false, error: err }
        } finally {
            if (isCurrentTransition(generation)) setLoading(false)
            googleLoginInFlight.current = false
        }
    }, [beginTransition, isCurrentTransition, setLoading, setUser])

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
    }, [beginTransition, isCurrentTransition, setLoading, setUser])

    useEffect(() => {

        const handleIdentitySignal = (event) => {
            const generation = beginTransition()
            const announcedUserId = event?.detail?.userId ?? event?.userId ?? null
            if ((user?.id || null) !== announcedUserId) { setExpectedUserId(null); setUser(null) }
            resolveCurrentUser(generation)
        }
        const onStorage = (event) => {
            if (event.key !== AUTH_EVENT_KEY) return
            try { handleIdentitySignal(JSON.parse(event.newValue || '{}')) } catch { handleIdentitySignal({ userId: null }) }
        }
        window.addEventListener(AUTH_EVENT_KEY, handleIdentitySignal)
        window.addEventListener('storage', onStorage)
        resolveCurrentUser(beginTransition())
        return () => {
            window.removeEventListener(AUTH_EVENT_KEY, handleIdentitySignal)
            window.removeEventListener('storage', onStorage)
        }

    }, [ beginTransition, resolveCurrentUser, setUser, user?.id ])

    return { user, loading, handleGoogleLogin, handleLogout }
}
