import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import "../auth.form.scss"
import { useAuth } from '../hooks/useAuth'
import { loadGoogleIdentityServices } from '../services/google.identity'
import NetworkParticleBackground from '../components/NetworkParticleBackground'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

const Login = () => {
    const { user, loading, handleGoogleLogin } = useAuth()
    const navigate = useNavigate()
    const googleButtonRef = useRef(null)
    const googleCallbackRef = useRef(null)
    const googleInitializedRef = useRef(false)
    const manifestoCloseRef = useRef(null)
    const [googleError, setGoogleError] = useState(() => googleClientId ? "" : "Google Sign-In is not configured.")
    const [manifestoOpen, setManifestoOpen] = useState(false)

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
            google.accounts.id.renderButton(googleButtonRef.current, {
                theme: "outline_dark",
                size: "large",
                text: "signin_with",
                shape: "pill",
                logo_alignment: "center",
                width: Math.min(400, Math.floor(googleButtonRef.current.clientWidth))
            })
            googleInitializedRef.current = true
        }).catch((err) => { if (!cancelled) setGoogleError(err.message) })
        return () => { cancelled = true }
    }, [loading])

    useEffect(() => {
        if (!manifestoOpen) return undefined
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        manifestoCloseRef.current?.focus()
        const handleKeyDown = (event) => {
            if (event.key === "Escape") setManifestoOpen(false)
        }
        document.addEventListener("keydown", handleKeyDown)
        return () => {
            document.body.style.overflow = previousOverflow
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [manifestoOpen])

    if (loading) return (
        <main className="auth-page auth-page--loading">
            <NetworkParticleBackground />
            <div className="auth-loading" role="status" aria-live="polite">Signing you in...</div>
        </main>
    )

    return (
        <main className="auth-page">
            <NetworkParticleBackground />
            <nav className="auth-nav" aria-label="Primary navigation">
                <div className="auth-brand" aria-label="AlmaCV">
                    <img className="auth-brand-logo" src="/assets/almacv-fanburst.png" alt="" aria-hidden="true" />
                    <span className="auth-brand-name">AlmaCV</span>
                </div>
                <span className="auth-nav-separator" aria-hidden="true" />
                <button className="auth-nav-item" type="button" onClick={() => setManifestoOpen(true)}>Manifesto</button>
                <span className="auth-nav-separator" aria-hidden="true" />
                <a className="auth-nav-item" href="mailto:sujalhaldar2004@gmail.com" target="_blank" rel="noopener noreferrer">Contact</a>
            </nav>

            <div className="auth-container">
                <img className="auth-hero-logo" src="/assets/almacv-fanburst.png" alt="AlmaCV" />
                <div className="auth-copy">
                    <p className="auth-eyebrow">RESUME INTELLIGENCE</p>
                    <h1>One Resume. Every Opportunity.</h1>
                    <p className="auth-subheading">Your resume, tailored for every role.</p>
                </div>
                <div className="google-button-mount" ref={googleButtonRef} />
                {googleError && <p className="auth-error" role='alert'>{googleError}</p>}
                <p className="auth-footnote">Secure authentication <span aria-hidden="true">·</span> Powered by Google</p>
            </div>

            {manifestoOpen && (
                <div className="manifesto-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManifestoOpen(false) }}>
                    <section className="manifesto-modal" role="dialog" aria-modal="true" aria-labelledby="manifesto-title" aria-describedby="manifesto-intro">
                        <button className="manifesto-close" type="button" ref={manifestoCloseRef} onClick={() => setManifestoOpen(false)} aria-label="Close manifesto">×</button>
                        <p className="manifesto-eyebrow">THE INTERVIEW AI MANIFESTO</p>
                        <h2 id="manifesto-title">One resume. Every opportunity.</h2>
                        <p className="manifesto-subheading">Stop rewriting. Start applying.</p>
                        <div className="manifesto-body" id="manifesto-intro">
                            <p>Every job deserves a relevant resume. But applying to opportunity after opportunity shouldn't mean rebuilding yours from scratch every single time.</p>
                            <p>Your experience, projects, education, and skills already exist. Interview AI helps you put them in the right context.</p>
                            <p>Upload your master resume. Add a job description. Let AI analyze the requirements and tailor your resume to highlight the experience that matters for that role.</p>
                            <h3>Your experience stays yours.</h3>
                            <p>No fabricated achievements. No invented skills. Just your real qualifications, presented with relevance.</p>
                            <h3>Less repetitive work. More opportunities.</h3>
                            <p className="manifesto-closing">INTERVIEW AI — YOUR NEXT OPPORTUNITY STARTS HERE.</p>
                        </div>
                    </section>
                </div>
            )}
        </main>
    )
}

export default Login
