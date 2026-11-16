import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import "../auth.form.scss"
import { useAuth } from '../hooks/useAuth'
import { loadGoogleIdentityServices } from '../services/google.identity'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

const Login = () => {
    const { user, loading, handleGoogleLogin } = useAuth()
    const navigate = useNavigate()
    const googleButtonRef = useRef(null)
    const googleCallbackRef = useRef(null)
    const googleInitializedRef = useRef(false)
    const [googleError, setGoogleError] = useState(() => googleClientId ? "" : "Google Sign-In is not configured.")

    useEffect(() => {
        if (!loading && user) navigate('/', { replace: true })
    }, [loading, navigate, user])

    useEffect(() => {
        googleCallbackRef.current = async (response) => {
            setGoogleError("")
            const result = await handleGoogleLogin(response?.credential)
            if (result?.success) navigate('/', { replace: true })
            else if (result?.error?.code !== "AUTH_IN_PROGRESS") setGoogleError(result?.error?.response?.data?.message || result?.error?.message || "We couldn't sign you in with Google. Please try again.")
        }
    }, [handleGoogleLogin, navigate])

    useEffect(() => {
        let cancelled = false
        if (!googleClientId || loading) return undefined
        loadGoogleIdentityServices().then((google) => {
            if (cancelled || !googleButtonRef.current || googleInitializedRef.current) return
            google.accounts.id.initialize({
                client_id: googleClientId,
                callback: (response) => { void googleCallbackRef.current?.(response) },
                auto_select: false,
                cancel_on_tap_outside: true
            })
            google.accounts.id.renderButton(googleButtonRef.current, { theme: "outline", size: "large", text: "continue_with", width: 320 })
            googleInitializedRef.current = true
        }).catch((err) => { if (!cancelled) setGoogleError(err.message) })
        return () => { cancelled = true }
    }, [loading])

    if (loading) return (<main><h1>Signing you in...</h1></main>)

    return (
        <main>
            <div className="form-container auth-container">
                <h1>Welcome to Interview AI</h1>
                <p>Analyze your resume and discover your next opportunity.</p>
                <div className="google-signin" ref={googleButtonRef} aria-label="Continue with Google" />
                {googleError && <p role='alert'>{googleError}</p>}
            </div>
        </main>
    )
}

export default Login
