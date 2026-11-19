import { useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { InterviewContext } from '../../interview/interview.context'
import { deleteInterviewReport, updateReportPin, updateReportTitle } from '../../interview/services/interview.api'
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
    const { historyLoading, reports, reportsError, user, setReports } = useContext(InterviewContext)
    const { handleLogout } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const profileRef = useRef(null)
    const menuRef = useRef(null)
    const accountCloseRef = useRef(null)
    const reportMenuRef = useRef(null)
    const activeId = location.pathname.startsWith('/interview/') ? location.pathname.split('/')[2] : null
    const profileName = getProfileName(user)
    const profileImage = user?.profilePicture
    const profileInitials = getInitials(user)

    useEffect(() => {
        if (!menuOpen && !accountOpen && !reportMenu) return undefined
        const handlePointerDown = event => {
            if (reportMenu && !reportMenuRef.current?.contains(event.target)) setReportMenu(null)
            if (!profileRef.current?.contains(event.target)) {
                setMenuOpen(false)
                setAccountOpen(false)
            }
        }
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
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
    }, [ menuOpen, accountOpen, reportMenu ])

    const openReportMenu = (event, reportId) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        setReportMenu({ id: reportId, top: Math.min(rect.bottom + 4, window.innerHeight - 150), left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 168)) })
    }
    const renameHistoryReport = async report => {
        const title = window.prompt('Rename report', report.title || 'Untitled report')
        if (title == null || !title.trim()) return
        const response = await updateReportTitle({ interviewReportId: report._id, title: title.trim() })
        setReports(previous => previous.map(item => item._id === report._id ? { ...item, ...response.interviewReport } : item))
        setReportMenu(null)
    }
    const toggleReportPin = async report => { await updateReportPin({ interviewReportId: report._id, isPinned: !report.isPinned }); setReports(previous => previous.map(item => item._id === report._id ? { ...item, isPinned: !report.isPinned } : item)); setReportMenu(null) }
    const deleteHistoryReport = async report => {
        if (!window.confirm(`Delete “${report.title || 'Untitled report'}”?`)) return
        await deleteInterviewReport(report._id)
        setReports(previous => previous.filter(item => item._id !== report._id))
        setReportMenu(null)
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
                        {historyLoading && <div className='app-sidebar__history-state'>Loading reports…</div>}
                        {!historyLoading && reportsError && <div className='app-sidebar__history-state app-sidebar__history-state--error'>{reportsError}</div>}
                        {!historyLoading && !reportsError && !reports.length && <div className='app-sidebar__history-state'>No reports yet</div>}
                        {!historyLoading && !reportsError && reports.length > 0 && (
                            <div className='app-sidebar__history-list'>
                                {reports.map(report => (
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
                                ))}
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
                        <button type='button' role='menuitem' onClick={() => renameHistoryReport(report)}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M4 20h4L19 9l-4-4L4 16v4Z' /><path d='m13.5 6.5 4 4' /></svg><span>Rename</span></button>
                        <button type='button' role='menuitem' onClick={() => toggleReportPin(report)}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M8 4h8l-1 5 3 3v2H6v-2l3-3-1-5Z' /><path d='M12 14v7' /></svg><span>{report.isPinned ? 'Unpin' : 'Pin'}</span></button>
                        <button className='is-destructive' type='button' role='menuitem' onClick={() => deleteHistoryReport(report)}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13M10 11v5m4-5v5' /></svg><span>Delete</span></button>
                    </div>
                })()}
            </aside>
            <div className='authenticated-shell__content'>{children}</div>
        </div>
    )
}

export default AuthenticatedShell
