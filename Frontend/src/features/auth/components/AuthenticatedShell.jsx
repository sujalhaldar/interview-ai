import { useContext, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { InterviewContext } from '../../interview/interview.context'
import './authenticated-shell.scss'

const AuthenticatedShell = ({ children }) => {
    const [expanded, setExpanded] = useState(false)
    const { historyLoading, reports, reportsError } = useContext(InterviewContext)
    const navigate = useNavigate()
    const location = useLocation()
    const activeId = location.pathname.startsWith('/interview/') ? location.pathname.split('/')[2] : null

    return (
        <div className={`authenticated-shell${expanded ? ' authenticated-shell--expanded' : ''}`}>
            <aside
                className='app-sidebar'
                aria-label='Application navigation'
                onClick={(event) => {
                    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
                    if (!expanded && !event.target.closest('.app-sidebar__toggle')) setExpanded(true)
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
                                    <button
                                        className={`app-sidebar__history-item${activeId === report._id ? ' is-active' : ''}`}
                                        type='button'
                                        key={report._id}
                                        onClick={() => navigate(`/interview/${report._id}`)}
                                        title={report.title || 'Untitled report'}
                                    >
                                        <span className='app-sidebar__history-title'>{report.title || 'Untitled report'}</span>
                                        <span className='app-sidebar__history-meta'>
                                            {[report.company || report.companyName, report.matchScore != null ? `${report.matchScore}%` : '—', report.createdAt ? new Date(report.createdAt).toLocaleDateString() : 'Date unavailable'].filter(Boolean).join(' · ')}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </aside>
            <div className='authenticated-shell__content'>{children}</div>
        </div>
    )
}

export default AuthenticatedShell
