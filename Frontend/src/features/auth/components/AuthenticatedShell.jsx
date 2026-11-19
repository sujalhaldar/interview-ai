import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { InterviewContext } from '../../interview/interview.context'
import { deleteInterviewReport, updateReportTitle } from '../../interview/services/interview.api'
import { useAuth } from '../hooks/useAuth'
import './authenticated-shell.scss'

const getProfileName = user => user?.username || user?.email || 'Account'

const getInitials = user => getProfileName(user)
    .split(/\s+|[-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?'

const AuthenticatedShell = ({ children }) => {
    const [expanded, setExpanded] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [accountOpen, setAccountOpen] = useState(false)
    const [logoutPending, setLogoutPending] = useState(false)
    const [reportMenu, setReportMenu] = useState(null)
    const [deleteCandidate, setDeleteCandidate] = useState(null)
    const [deletePending, setDeletePending] = useState(false)
    const [deleteError, setDeleteError] = useState('')
    const [renameCandidate, setRenameCandidate] = useState(null)
    const [renameTitle, setRenameTitle] = useState('')
    const [renamePending, setRenamePending] = useState(false)
    const [renameError, setRenameError] = useState('')
    const [pinPendingId, setPinPendingId] = useState(null)
    const [pinError, setPinError] = useState('')
    const { historyLoading, historyLoaded, reports, reportsError, user, setReports, pinReport } = useContext(InterviewContext)
    const { handleLogout } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const profileRef = useRef(null)
    const menuRef = useRef(null)
    const accountCloseRef = useRef(null)
    const reportMenuRef = useRef(null)
    const deleteCancelRef = useRef(null)
    const deleteTriggerRef = useRef(null)
    const renameInputRef = useRef(null)
    const renameTriggerRef = useRef(null)
    const activeId = location.pathname.startsWith('/interview/') ? location.pathname.split('/')[2] : null
    const profileName = getProfileName(user)
    const profileImage = user?.profilePicture
    const profileInitials = getInitials(user)
    const { pinnedReports, recentReports } = useMemo(() => {
        const byDateDescending = (left, right, field) => {
            const leftTime = left[field] ? new Date(left[field]).getTime() : 0
            const rightTime = right[field] ? new Date(right[field]).getTime() : 0
            return rightTime - leftTime || String(right._id).localeCompare(String(left._id))
        }
        return {
            pinnedReports: reports.filter(report => report.isPinned === true).sort((left, right) => byDateDescending(left, right, 'pinnedAt')),
            recentReports: reports.filter(report => report.isPinned !== true).sort((left, right) => byDateDescending(left, right, 'createdAt'))
        }
    }, [ reports ])

    useEffect(() => {
        if (!menuOpen && !accountOpen && !reportMenu && !deleteCandidate && !renameCandidate) return undefined
        const handlePointerDown = event => {
            if (reportMenu && !reportMenuRef.current?.contains(event.target)) setReportMenu(null)
            if (!profileRef.current?.contains(event.target)) {
                setMenuOpen(false)
                setAccountOpen(false)
            }
        }
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                if (deleteCandidate) {
                    if (!deletePending) setDeleteCandidate(null)
                    return
                }
                if (renameCandidate) {
                    if (!renamePending) setRenameCandidate(null)
                    return
                }
                if (reportMenu) { setReportMenu(null); return }
                setMenuOpen(false)
                setAccountOpen(false)
                profileRef.current?.querySelector('.app-sidebar__profile-control')?.focus()
            }
        }
        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [ menuOpen, accountOpen, reportMenu, deleteCandidate, deletePending, renameCandidate, renamePending ])

    useEffect(() => {
        if (deleteCandidate) {
            deleteCancelRef.current?.focus()
            return
        }
        deleteTriggerRef.current?.focus()
        deleteTriggerRef.current = null
    }, [ deleteCandidate ])

    useEffect(() => {
        if (renameCandidate) {
            renameInputRef.current?.focus()
            renameInputRef.current?.select()
            return
        }
        renameTriggerRef.current?.focus()
        renameTriggerRef.current = null
    }, [ renameCandidate ])

    const openReportMenu = (event, reportId) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        setReportMenu({ id: reportId, top: Math.min(rect.bottom + 4, window.innerHeight - 150), left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 168)) })
    }
    const requestRenameHistoryReport = (event, report) => {
        event.stopPropagation()
        renameTriggerRef.current = event.currentTarget
        setReportMenu(null)
        setRenameTitle(report.title || '')
        setRenameError('')
        setRenameCandidate(report)
    }

    const closeRenameDialog = () => {
        if (renamePending) return
        setRenameError('')
        setRenameCandidate(null)
    }

    const renameHistoryReport = async event => {
        event.preventDefault()
        if (!renameCandidate || renamePending) return
        const title = renameTitle.trim()
        if (!title) {
            setRenameError('Enter a report title.')
            return
        }
        if (title === (renameCandidate.title || '').trim()) {
            closeRenameDialog()
            return
        }
        setRenamePending(true)
        setRenameError('')
        try {
            const response = await updateReportTitle({ interviewReportId: renameCandidate._id, title })
            setReports(previous => previous.map(item => item._id === renameCandidate._id ? { ...item, ...response.interviewReport } : item))
            setRenameCandidate(null)
        } catch {
            setRenameError('We could not rename this report. Please try again.')
        } finally {
            setRenamePending(false)
        }
    }
    const toggleReportPin = async report => {
        if (pinPendingId === report._id) return
        setPinPendingId(report._id)
        setPinError('')
        try {
            await pinReport(report._id, !report.isPinned)
            setReportMenu(null)
        } catch {
            setPinError('We could not update the pin state. Please try again.')
        } finally {
            setPinPendingId(null)
        }
    }
    const requestDeleteHistoryReport = (event, report) => {
        event.stopPropagation()
        deleteTriggerRef.current = event.currentTarget
        setReportMenu(null)
        setDeleteError('')
        setDeleteCandidate(report)
    }

    const closeDeleteDialog = () => {
        if (deletePending) return
        setDeleteError('')
        setDeleteCandidate(null)
    }

    const deleteHistoryReport = async () => {
        if (!deleteCandidate || deletePending) return
        const report = deleteCandidate
        setDeletePending(true)
        setDeleteError('')
        try {
            await deleteInterviewReport(report._id)
            setReports(previous => previous.filter(item => item._id !== report._id))
            if (activeId === report._id) {
                const remainingReport = reports.find(item => item._id !== report._id)
                navigate(remainingReport ? `/interview/${remainingReport._id}` : '/', { replace: true })
            }
            setDeleteCandidate(null)
        } catch {
            setDeleteError('We could not delete this report. Please try again.')
        } finally {
            setDeletePending(false)
        }
    }

    useEffect(() => {
        if (menuOpen) menuRef.current?.querySelector('[role="menuitem"]')?.focus()
    }, [ menuOpen ])

    useEffect(() => {
        if (accountOpen) accountCloseRef.current?.focus()
    }, [ accountOpen ])

    const closeAccount = () => {
        setAccountOpen(false)
        profileRef.current?.querySelector('.app-sidebar__profile-control')?.focus()
    }

    const submitLogout = async () => {
        if (logoutPending) return
        setLogoutPending(true)
        setMenuOpen(false)
        const result = await handleLogout()
        if (result?.success) navigate('/login', { replace: true })
        setLogoutPending(false)
    }

    const handleMenuKeyDown = event => {
        const items = [...menuRef.current?.querySelectorAll('[role="menuitem"]') || []]
        const index = items.indexOf(document.activeElement)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
            items[next]?.focus()
        }
    }

    const renderHistoryReport = report => (
        <div
            className={`app-sidebar__history-item${activeId === report._id ? ' is-active' : ''}`}
            key={report._id}
            onClick={() => navigate(`/interview/${report._id}`)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/interview/${report._id}`) } }}
            role='button'
            tabIndex='0'
        >
            <span className='app-sidebar__history-title'>{report.title || 'Untitled report'}</span>
            <span className='app-sidebar__history-meta'>
                {[report.company || report.companyName, report.matchScore != null ? `${report.matchScore}%` : '—', report.createdAt ? new Date(report.createdAt).toLocaleDateString() : 'Date unavailable'].filter(Boolean).join(' · ')}
            </span>
            <button className='app-sidebar__history-actions' type='button' aria-label={`Actions for ${report.title || 'Untitled report'}`} aria-haspopup='menu' aria-expanded={reportMenu?.id === report._id} onClick={event => openReportMenu(event, report._id)}>⋯</button>
        </div>
    )

    return (
        <div className={`authenticated-shell${expanded ? ' authenticated-shell--expanded' : ''}`}>
            <aside
                className='app-sidebar'
                aria-label='Application navigation'
                onClick={(event) => {
                    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
                    if (!expanded && !event.target.closest('.app-sidebar__toggle, .app-sidebar__profile-control, .app-sidebar__account-menu')) setExpanded(true)
                }}
            >
                <div className='app-sidebar__top'>
                    <div className={expanded ? 'app-sidebar__brand-row' : undefined}>
                        {expanded ? (
                            <div className='app-sidebar__branding'>
                                <span className='app-sidebar__logo-wrap'>
                                    <img className='app-sidebar__logo' src='/assets/almacv-fanburst.png' alt='' aria-hidden='true' />
                                </span>
                                <span className='app-sidebar__brand'>AlmaCV</span>
                            </div>
                        ) : (
                            <button
                                className='app-sidebar__toggle'
                                type='button'
                                onClick={() => setExpanded(true)}
                                aria-label='Expand sidebar'
                                title='Expand sidebar'
                            >
                                <span className='app-sidebar__logo-wrap'>
                                    <img className='app-sidebar__logo' src='/assets/almacv-fanburst.png' alt='' aria-hidden='true' />
                                    <svg className='app-sidebar__toggle-icon' viewBox='0 0 24 24' aria-hidden='true'><rect x='3' y='4' width='6' height='16' rx='1' /><path d='M11 4h10v16H11' /><path d='M9 4v16' /></svg>
                                </span>
                            </button>
                        )}
                        {expanded && (
                            <button className='app-sidebar__collapse' type='button' onClick={() => setExpanded(false)} aria-label='Collapse sidebar' title='Collapse sidebar'>
                                <svg className='app-sidebar__panel-icon' viewBox='0 0 24 24' aria-hidden='true'><rect x='3' y='4' width='6' height='16' rx='1' /><path d='M11 4h10v16H11' /><path d='M9 4v16' /></svg>
                            </button>
                        )}
                    </div>
                    {expanded && <span className='app-sidebar__label'>YOUR REPORTS</span>}
                </div>
                {expanded && (
                    <div className='app-sidebar__history' aria-live='polite'>
                        {(historyLoading || !historyLoaded) && <div className='app-sidebar__history-state'>Loading reports…</div>}
                        {!historyLoading && historyLoaded && reportsError && !reports.length && <div className='app-sidebar__history-state app-sidebar__history-state--error'>{reportsError}</div>}
                        {!historyLoading && historyLoaded && reportsError && reports.length > 0 && <div className='app-sidebar__history-state app-sidebar__history-state--error'>{reportsError}</div>}
                        {!historyLoading && historyLoaded && !reportsError && !reports.length && <div className='app-sidebar__history-state'>No reports yet</div>}
                        {!historyLoading && historyLoaded && reports.length > 0 && (
                            <div className='app-sidebar__history-list'>
                                {pinnedReports.length > 0 && <section className='app-sidebar__history-section' aria-labelledby='pinned-reports-heading'>
                                    <h2 id='pinned-reports-heading' className='app-sidebar__history-section-heading'>PINNED</h2>
                                    {pinnedReports.map(renderHistoryReport)}
                                </section>}
                                {recentReports.length > 0 && <section className='app-sidebar__history-section' aria-labelledby='recent-reports-heading'>
                                    <h2 id='recent-reports-heading' className='app-sidebar__history-section-heading'>RECENT REPORTS</h2>
                                    {recentReports.map(renderHistoryReport)}
                                </section>}
                            </div>
                        )}
                    </div>
                )}
                <div className='app-sidebar__profile' ref={profileRef}>
                    <button className='app-sidebar__profile-control' type='button' aria-label={`Open account menu for ${profileName}`} aria-haspopup='menu' aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value); setAccountOpen(false) }}>
                        <span className='app-sidebar__avatar' aria-hidden='true'>
                            {profileImage ? <img src={profileImage} alt='' /> : profileInitials}
                        </span>
                        {expanded && (
                            <span className='app-sidebar__profile-copy'>
                                <span className='app-sidebar__profile-name'>{profileName}</span>
                                <span className='app-sidebar__profile-label'>Account</span>
                            </span>
                        )}
                    </button>
                    {menuOpen && (
                        <div className='app-sidebar__account-menu' ref={menuRef} role='menu' aria-label='Account menu' onKeyDown={handleMenuKeyDown}>
                            <button type='button' role='menuitem' onClick={() => { setMenuOpen(false); setAccountOpen(true) }}>
                                <svg viewBox='0 0 24 24' aria-hidden='true'><circle cx='12' cy='8' r='3.5' /><path d='M5 20c.7-3.3 3.1-5 7-5s6.3 1.7 7 5' /></svg>
                                <span>Account information</span>
                            </button>
                            <div className='app-sidebar__account-menu-divider' role='separator' />
                            <button type='button' role='menuitem' disabled={logoutPending} onClick={submitLogout}>
                                <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M10 5H5v14h5' /><path d='M13 8l4 4-4 4' /><path d='M17 12H8' /></svg>
                                <span>{logoutPending ? 'Logging out…' : 'Log out'}</span>
                            </button>
                        </div>
                    )}
                    {accountOpen && (
                        <div className='app-sidebar__account-dialog-backdrop' role='presentation' onMouseDown={event => { if (event.target === event.currentTarget) closeAccount() }}>
                            <section className='app-sidebar__account-dialog' role='dialog' aria-modal='true' aria-labelledby='account-dialog-title'>
                                <div className='app-sidebar__account-dialog-heading'>
                                    <span className='app-sidebar__avatar' aria-hidden='true'>{profileImage ? <img src={profileImage} alt='' /> : profileInitials}</span>
                                    <div><h2 id='account-dialog-title'>Account information</h2><p>{profileName}</p></div>
                                </div>
                                <dl><dt>Email</dt><dd>{user?.email || 'Not available'}</dd></dl>
                                <button ref={accountCloseRef} type='button' onClick={closeAccount}>Close</button>
                            </section>
                        </div>
                    )}
                </div>
                {reportMenu && (() => {
                    const report = reports.find(item => item._id === reportMenu.id)
                    if (!report) return null
                    return <div ref={reportMenuRef} className='app-sidebar__report-menu' role='menu' aria-label='Report actions' style={{ top: reportMenu.top, left: reportMenu.left }}>
                        <button type='button' role='menuitem' onClick={event => requestRenameHistoryReport(event, report)}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M4 20h4L19 9l-4-4L4 16v4Z' /><path d='m13.5 6.5 4 4' /></svg><span>Rename</span></button>
                        {pinError && <div className='app-sidebar__report-menu-error' role='alert'>{pinError}</div>}
                        <button type='button' role='menuitem' disabled={pinPendingId === report._id} onClick={() => toggleReportPin(report)}><svg viewBox='0 0 24 24' aria-hidden='true'>{report.isPinned ? <><path d='M12 17v5' /><path d='m9 13 3-3 3 3' /><path d='M15.5 7.5 19 11v2H5v-2l3.5-3.5' /><path d='M12 2v3' /><path d='m2 2 20 20' /></> : <><path d='M8 4h8l-1 5 3 3v2H6v-2l3-3-1-5Z' /><path d='M12 14v7' /></>}</svg><span>{pinPendingId === report._id ? 'Saving…' : (report.isPinned ? 'Unpin' : 'Pin')}</span></button>
                        <button className='is-destructive' type='button' role='menuitem' onClick={event => requestDeleteHistoryReport(event, report)}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13M10 11v5m4-5v5' /></svg><span>Delete</span></button>
                    </div>
                })()}
                {deleteCandidate && (
                    <div className='app-sidebar__delete-dialog-backdrop' role='presentation' onMouseDown={event => { if (event.target === event.currentTarget) closeDeleteDialog() }}>
                        <section className='app-sidebar__delete-dialog' role='dialog' aria-modal='true' aria-labelledby='delete-report-title' aria-describedby='delete-report-message'>
                            <h2 id='delete-report-title'>Delete report?</h2>
                            <p id='delete-report-message'>This will permanently delete <strong>{deleteCandidate.title || 'Untitled report'}</strong>. This action cannot be undone.</p>
                            {deleteError && <p className='app-sidebar__delete-dialog-error' role='alert'>{deleteError}</p>}
                            <div className='app-sidebar__delete-dialog-actions'>
                                <button ref={deleteCancelRef} type='button' onClick={closeDeleteDialog} disabled={deletePending}>Cancel</button>
                                <button className='is-destructive' type='button' onClick={deleteHistoryReport} disabled={deletePending}>{deletePending ? 'Deleting…' : 'Delete report'}</button>
                            </div>
                        </section>
                    </div>
                )}
                {renameCandidate && (
                    <div className='app-sidebar__rename-dialog-backdrop' role='presentation' onMouseDown={event => { if (event.target === event.currentTarget) closeRenameDialog() }}>
                        <form className='app-sidebar__rename-dialog' role='dialog' aria-modal='true' aria-labelledby='rename-report-title' aria-describedby='rename-report-message' onSubmit={renameHistoryReport}>
                            <h2 id='rename-report-title'>Rename report</h2>
                            <p id='rename-report-message'>Keep it short and recognizable.</p>
                            <label htmlFor='rename-report-input'>Report title</label>
                            <input ref={renameInputRef} id='rename-report-input' value={renameTitle} onChange={event => setRenameTitle(event.target.value)} aria-invalid={Boolean(renameError)} autoComplete='off' />
                            {renameError && <p className='app-sidebar__rename-dialog-error' role='alert'>{renameError}</p>}
                            <div className='app-sidebar__rename-dialog-actions'>
                                <button type='button' onClick={closeRenameDialog} disabled={renamePending}>Cancel</button>
                                <button className='is-save' type='submit' disabled={renamePending}>{renamePending ? 'Saving…' : 'Save'}</button>
                            </div>
                        </form>
                    </div>
                )}
            </aside>
            <div className='authenticated-shell__content'>{children}</div>
        </div>
    )
}

export default AuthenticatedShell
