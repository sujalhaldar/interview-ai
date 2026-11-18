import { useState } from 'react'
import './authenticated-shell.scss'

const AuthenticatedShell = ({ children }) => {
    const [expanded, setExpanded] = useState(false)

    return (
        <div className={`authenticated-shell${expanded ? ' authenticated-shell--expanded' : ''}`}>
            <aside className='app-sidebar' aria-label='Application navigation'>
                <div className='app-sidebar__top'>
                    <button
                        className='app-sidebar__toggle'
                        type='button'
                        onClick={() => setExpanded(value => !value)}
                        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
                        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
                    >
                        <span className='app-sidebar__logo-wrap'>
                            <img className='app-sidebar__logo' src='/assets/almacv-fanburst.png' alt='' aria-hidden='true' />
                            <span className='app-sidebar__toggle-icon' aria-hidden='true'><i /><i /><i /></span>
                        </span>
                        {expanded && <span className='app-sidebar__brand'>AlmaCV</span>}
                    </button>
                    {expanded && <span className='app-sidebar__label'>Workspace</span>}
                </div>
                {expanded && (
                    <div className='app-sidebar__reserved' aria-hidden='true'>
                        <span className='app-sidebar__reserved-line' />
                        <span>Navigation</span>
                    </div>
                )}
            </aside>
            <div className='authenticated-shell__content'>{children}</div>
        </div>
    )
}

export default AuthenticatedShell
