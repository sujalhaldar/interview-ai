import React, { useEffect, useState, useRef } from 'react'
import "../style/home.scss"
import { useInterview } from '../hooks/useInterview.js'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/hooks/useAuth'
import NetworkParticleBackground from '../../auth/components/NetworkParticleBackground'

const Home = () => {

    const { analysisLoading, historyLoading, analysisProgress, generateReport, reports, reportsError, renameReport, pinReport, removeReport } = useInterview()
    const { user, handleLogout } = useAuth()
    const [ jobDescription, setJobDescription ] = useState("")
    const [ selfDescription, setSelfDescription ] = useState("")
    const [ resumeFile, setResumeFile ] = useState(null)
    const [ generationError, setGenerationError ] = useState('')
    const [ fieldErrors, setFieldErrors ] = useState({ jobDescription: '', resume: '' })
    const resumeInputRef = useRef()
    const idempotencyKeyRef = useRef(null)
    const [openMenu, setOpenMenu] = useState(null)
    const [renameTarget, setRenameTarget] = useState(null)
    const [renameValue, setRenameValue] = useState('')
    const [historyError, setHistoryError] = useState('')
    const [pendingAction, setPendingAction] = useState(null)
    const [logoutPending, setLogoutPending] = useState(false)
    const [logoutError, setLogoutError] = useState('')
    const renameButtonRefs = useRef({})
    const reportMenuRefs = useRef({})

    const navigate = useNavigate()

    const submitLogout = async () => {
        if (logoutPending) return
        setLogoutPending(true)
        setLogoutError('')
        const result = await handleLogout()
        if (result?.success) navigate('/login', { replace: true })
        else setLogoutError('Unable to sign out. Please try again.')
        setLogoutPending(false)
    }

    useEffect(() => {
        if (!renameTarget) return undefined
        const onKeyDown = (event) => {
            if (event.key === 'Escape') { const id = renameTarget._id; setRenameTarget(null); window.setTimeout(() => renameButtonRefs.current[id]?.focus(), 0); return }
            if (event.key !== 'Tab') return
            const dialog = document.querySelector('.rename-modal')
            if (!dialog) return
            const focusable = [...dialog.querySelectorAll('input, button')]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [renameTarget])

    useEffect(() => {
        if (!openMenu) return undefined
        const onPointerDown = (event) => {
            const menu = reportMenuRefs.current[openMenu]
            const trigger = renameButtonRefs.current[openMenu]
            if (!menu?.contains(event.target) && !trigger?.contains(event.target)) setOpenMenu(null)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
    }, [openMenu])

    const runHistoryAction = async (key, action) => {
        setPendingAction(key)
        setHistoryError('')
        try { await action(); setOpenMenu(null) } catch (error) { setHistoryError(error?.response?.data?.message || 'Unable to update this report. Please try again.') } finally { setPendingAction(null) }
    }

    const submitRename = async (event) => {
        event.preventDefault()
        const title = renameValue.trim()
        if (!title || title.length > 160) return
        await runHistoryAction(renameTarget._id, async () => { await renameReport(renameTarget._id, title); closeRename() })
    }

    const closeRename = () => { const id = renameTarget?._id; setRenameTarget(null); if (id) window.setTimeout(() => renameButtonRefs.current[id]?.focus(), 0) }

    const handleGenerateReport = async () => {
        if (analysisLoading) return

        setGenerationError('')
        setFieldErrors({ jobDescription: '', resume: '' })
        if (!jobDescription.trim()) {
            setFieldErrors((errors) => ({ ...errors, jobDescription: 'Please enter a job description.' }))
        }
        if (!resumeFile) {
            setFieldErrors((errors) => ({ ...errors, resume: 'Please upload your resume PDF.' }))
        }
        if (!jobDescription.trim() || !resumeFile) {
            return
        }

        try {
            if (!idempotencyKeyRef.current) idempotencyKeyRef.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
            const data = await generateReport({ jobDescription, selfDescription, resumeFile, idempotencyKey: idempotencyKeyRef.current })
            if (!data?._id) {
                throw new Error('Generated report did not include a report ID.')
            }
            navigate(`/interview/${data._id}`)
            idempotencyKeyRef.current = null
        } catch (error) {
            const status = error?.response?.status
            const backendMessage = error?.response?.data?.message
            if (status === 502 && backendMessage === 'Resume analysis service is temporarily unavailable.') {
                setGenerationError(backendMessage)
            } else if (status === 401) {
                setGenerationError('Your session has expired. Please sign in again.')
            } else {
                setGenerationError("We couldn't analyze your resume. Please try again.")
            }
        }
    }

    if (analysisLoading) {
        return (
            <main className='loading-screen'>
                <NetworkParticleBackground />
                <h1>Finding the story in your experience.</h1>
                <p>Analyzing your resume against the role to uncover your strengths and opportunities.</p>
                <div className='analysis-progress-bar' aria-hidden='true'><span /></div>
                <ol className='analysis-stages'>
                    {[['resume', 'Reading your resume'], ['role', 'Understanding the role'], ['matching', 'Matching your experience'], ['analysis', 'Building your analysis']].map(([stage, label]) => {
                        const current = analysisProgress?.stage
                        const complete = current === 'role' && stage === 'resume' || current === 'matching' && ['resume', 'role'].includes(stage) || current === 'analysis' && ['resume', 'role', 'matching'].includes(stage)
                        const active = current === stage
                        return <li key={stage} className={`${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`}><span className='stage-icon'>{complete ? '✓' : active ? '•' : '○'}</span>{label}</li>
                    })}
                </ol>
            </main>
        )
    }

    return (
        <div className='home-page'>
            <NetworkParticleBackground />

            {/* Page Header */}
            <header className='page-header'>
                <div className='account-bar'>
                    <span className='account-name'>{user?.username || user?.email}</span>
                    <button type='button' className='logout-button' onClick={submitLogout} disabled={logoutPending}>
                        {logoutPending ? 'Signing out…' : 'Logout'}
                    </button>
                </div>
                <h1>Give Your <span className='highlight'>Potential</span> a Place.</h1>
                <p>Discover your strengths, understand your opportunities, and shape your resume for what comes next.</p>
            </header>
            {logoutError && <p className='submission-error' role='alert'>{logoutError}</p>}

            {/* Main Card */}
            <div className='interview-card'>
                <div className='interview-card__body'>

                    {/* Left Panel - Job Description */}
                    <div className='panel panel--left'>
                        <div className='panel__header'>
                            <span className='panel__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                            </span>
                            <h2>Target Job Description</h2>
                            <span className='badge badge--required'>Required</span>
                        </div>
                        <textarea
                            value={jobDescription}
                            onChange={(e) => {
                                setJobDescription(e.target.value)
                                if (e.target.value.trim()) setFieldErrors((errors) => ({ ...errors, jobDescription: '' }))
                            }}
                            className='panel__textarea'
                            placeholder="Paste the job description you're targeting..."
                            maxLength={5000}
                        />
                        <div className='char-counter'>{jobDescription.length} / 5000 chars</div>
                        {fieldErrors.jobDescription && <p className='field-error' role='alert'>{fieldErrors.jobDescription}</p>}
                    </div>

                    {/* Vertical Divider */}
                    <div className='panel-divider' />

                    {/* Right Panel - Profile */}
                    <div className='panel panel--right'>
                        <div className='panel__header'>
                            <span className='panel__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            </span>
                            <h2>Your Resume</h2>
                        </div>

                        {/* Upload Resume */}
                        <div className='upload-section'>
                            <label className='section-label'>
                                Upload Your Resume
                                <span className='badge badge--required'>Required</span>
                            </label>
                            <label className='dropzone' htmlFor='resume'>
                                <span className='dropzone__icon'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /></svg>
                                </span>
                                <p className='dropzone__title'>Click to upload or drag &amp; drop</p>
                                <p className='dropzone__subtitle'>Upload your resume in PDF format (Max 3MB).</p>
                                <input
                                    ref={resumeInputRef}
                                    hidden
                                    type='file'
                                    id='resume'
                                    name='resume'
                                    accept='.pdf,application/pdf'
                                    onChange={(e) => {
                                        const file = e.target.files?.[0] ?? null
                                        if (file && file.type !== 'application/pdf') {
                                            setResumeFile(null)
                                            setFieldErrors((errors) => ({ ...errors, resume: 'Please upload a PDF file.' }))
                                            return
                                        }
                                        if (file && file.size > 3 * 1024 * 1024) {
                                            setResumeFile(null)
                                            setFieldErrors((errors) => ({ ...errors, resume: 'Resume PDF must be 3MB or smaller.' }))
                                            return
                                        }
                                        setResumeFile(file)
                                        if (file) setFieldErrors((errors) => ({ ...errors, resume: '' }))
                                    }}
                                />
                                {resumeFile && <p className='dropzone__filename'>{resumeFile.name}</p>}
                            </label>
                            {fieldErrors.resume && <p className='field-error' role='alert'>{fieldErrors.resume}</p>}
                        </div>

                        {/* OR Divider */}
                        <div className='or-divider'><span>OR</span></div>

                        {/* Additional Background */}
                        <div className='self-description'>
                            <label className='section-label' htmlFor='selfDescription'>Additional Background (Optional)</label>
                            <textarea
                                onChange={(e) => { setSelfDescription(e.target.value) }}
                                id='selfDescription'
                                name='selfDescription'
                                className='panel__textarea panel__textarea--short'
                                placeholder="Briefly describe relevant experience, skills, or context not covered in your resume..."
                            />
                        </div>

                        {/* Info Box */}
                        <div className='info-box'>
                            <span className='info-box__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" stroke="#1a1f27" strokeWidth="2" /><line x1="12" y1="16" x2="12.01" y2="16" stroke="#1a1f27" strokeWidth="2" /></svg>
                            </span>
                            <p>A <strong>Resume</strong> is required to analyze your profile and generate a tailored version.</p>
                        </div>
                    </div>
                </div>

                {/* Card Footer */}
                {generationError && <p className='submission-error' role='alert'>{generationError}</p>}
                <div className='interview-card__footer'>
                    <span className='footer-info'>Resume Analysis &amp; Tailored Resume Generation</span>
                    <button
                        onClick={handleGenerateReport}
                        disabled={analysisLoading}
                        className='generate-btn'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                        Analyze My Resume
                    </button>
                </div>
            </div>

            {/* Recent Reports List */}
            {(historyError || reportsError) && <p className='history-error' role='alert'>{historyError || reportsError}</p>}
            {historyLoading ? (
                <section className='recent-reports' aria-busy='true'><h2>Your Recent Resume Analyses</h2><p role='status'>Loading recent analyses...</p></section>
            ) : reports.length > 0 ? (
                <section className='recent-reports'>
                    <h2>Your Recent Resume Analyses</h2>
                    <ul className='reports-list'>
                        {reports.map(report => (
                            <li key={report._id} className={`report-item${report.isPinned ? ' report-item--pinned' : ''}`}>
                                <button className='report-card-open' type='button' onClick={() => navigate(`/interview/${report._id}`)}><h3>{report.title || 'Untitled Position'}</h3><p className='report-meta'>{report.isPinned ? 'Pinned' : 'Recent'} · {new Date(report.createdAt).toLocaleDateString()}</p><p className={`match-score ${report.matchScore >= 80 ? 'score--high' : report.matchScore >= 60 ? 'score--mid' : 'score--low'}`}>Match Score: {report.matchScore}%</p></button>
                                <button ref={element => { renameButtonRefs.current[report._id] = element }} className='report-menu-button' type='button' aria-label={`Actions for ${report.title || 'report'}`} aria-expanded={openMenu === report._id} disabled={pendingAction === report._id} onClick={(event) => { event.stopPropagation(); setOpenMenu(openMenu === report._id ? null : report._id) }}>⋯</button>
                                {openMenu === report._id && <div ref={element => { reportMenuRefs.current[report._id] = element }} className='report-menu' role='menu' onClick={event => event.stopPropagation()}><button type='button' role='menuitem' onClick={() => { setRenameTarget(report); setRenameValue(report.title || ''); setOpenMenu(null) }}>Rename</button><button type='button' role='menuitem' onClick={() => runHistoryAction(report._id, () => pinReport(report._id, !report.isPinned))}>{report.isPinned ? 'Unpin' : 'Pin'}</button><button type='button' role='menuitem' onClick={() => { if (window.confirm(`Delete “${report.title || 'Untitled Position'}”?`)) runHistoryAction(report._id, () => removeReport(report._id)) }}>Delete</button></div>}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : <section className='recent-reports recent-reports--empty'><h2>Your Recent Resume Analyses</h2><p>No resume analyses yet.</p></section>}

            {renameTarget && <div className='rename-modal-backdrop' role='presentation' onMouseDown={closeRename}><form className='rename-modal' role='dialog' aria-modal='true' aria-labelledby='rename-report-title' onSubmit={submitRename} onMouseDown={event => event.stopPropagation()}><h2 id='rename-report-title'>Rename report</h2><input value={renameValue} maxLength={160} autoFocus onChange={event => setRenameValue(event.target.value)} aria-label='Report title' /><p>{renameValue.trim().length > 160 ? 'Titles must be 160 characters or fewer.' : !renameValue.trim() ? 'Enter a report title.' : ''}</p><div><button type='button' onClick={closeRename}>Cancel</button><button type='submit' disabled={!renameValue.trim() || renameValue.trim().length > 160 || pendingAction === renameTarget._id}>Save</button></div></form></div>}

            {/* Page Footer */}
            <footer className='page-footer'>
                <a href='#'>Privacy Policy</a>
                <a href='#'>Terms of Service</a>
                <a href='#'>Help Center</a>
            </footer>
        </div>
    )
}

export default Home
