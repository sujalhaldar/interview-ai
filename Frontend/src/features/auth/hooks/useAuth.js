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
    const { user, setUser, loading, setLoading } = context
    const transitionGeneration = useRef(0)
    const googleLoginInFlight = useRef(false)

    const resolveCurrentUser = async (generation) => {
        try {
            const data = await getMe()
            if (generation !== transitionGeneration.current) return
            if (data?.user) { setExpectedUserId(data.user.id); setUser(data.user) }
        } catch {
            if (generation !== transitionGeneration.current) return
            setExpectedUserId(null); setUser(null)
        } finally {
            if (generation === transitionGeneration.current) setLoading(false)
        }
    }


    const handleGoogleLogin = useCallback(async (idToken) => {
        if (googleLoginInFlight.current) return { success: false, error: { code: "AUTH_IN_PROGRESS" } }
        googleLoginInFlight.current = true
        const generation = ++transitionGeneration.current
        setLoading(true)
        try {
            const data = await googleLogin(idToken)
            if (generation !== transitionGeneration.current) return { success: false, error: { code: "STALE_AUTH_TRANSITION" } }
            setUser(data.user); setExpectedUserId(data.user.id); broadcastAuthChange(data.user.id)
            return { success: true, user: data.user }
        } catch (err) {
            return { success: false, error: err }
        } finally {
            if (generation === transitionGeneration.current) setLoading(false)
            googleLoginInFlight.current = false
        }
    }, [setLoading, setUser])

    const handleLogout = async () => {
        transitionGeneration.current += 1
        setLoading(true)
        try {
            await logout()
            setUser(null)
            setExpectedUserId(null)
            broadcastAuthChange(null)
            return { success: true }
        } catch (err) {
            return { success: false, error: err }
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {

        const handleIdentitySignal = (event) => {
            const generation = ++transitionGeneration.current
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
        resolveCurrentUser(++transitionGeneration.current)
        return () => {
            window.removeEventListener(AUTH_EVENT_KEY, handleIdentitySignal)
            window.removeEventListener('storage', onStorage)
        }

    }, [ setLoading, setUser, user?.id ])

    return { user, loading, handleGoogleLogin, handleLogout }
}
