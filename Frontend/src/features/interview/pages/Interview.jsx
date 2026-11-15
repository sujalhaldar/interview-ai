import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useInterview } from '../hooks/useInterview'
import { adaptInterviewReport } from '../report.adapter'
import '../style/interview.scss'

const NAV_ITEMS = [
    ['summary', 'Overall Summary'],
    ['skills', 'Keyword & Skill Breakdown'],
    ['experience', 'Experience Alignment'],
    ['education', 'Education & Certifications'],
    ['quality', 'Resume Quality'],
]

const textOf = (value) => {
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object') return ''
    return value.explanation || value.description || value.text || value.title || ''
}

const evidenceOf = (value) => {
    if (!value || typeof value !== 'object') return []
    const evidence = value.evidence ?? value.supportingEvidence ?? value.matchedEvidence
    if (Array.isArray(evidence)) return evidence.filter(Boolean)
    return evidence ? [evidence] : []
}

const evidenceText = (value) => {
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object') return ''
    return value.evidenceText || value.originalText || value.normalizedValue || ''
}

function QualitativeList({ items, empty = 'No information is available in this report.' }) {
    if (!items.length) return <p className='summary-empty'>{empty}</p>
    return (
        <div className='summary-item-list'>
            {items.map((item, index) => (
                <article className='summary-item' key={item.id || (textOf(item) + '-' + index)}>
                    {typeof item === 'object' && item.title && <h3>{item.title}</h3>}
                    <p>{textOf(item)}</p>
                    {evidenceOf(item).length > 0 && <div className='summary-item__evidence'><span>Evidence</span><ul className='summary-evidence'>{evidenceOf(item).map((evidence, evidenceIndex) => <li key={evidenceText(evidence) + '-' + evidenceIndex}>{evidenceText(evidence)}</li>)}</ul></div>}
                </article>
            ))}
        </div>
    )
}

function RequirementList({ requirements, empty = 'No requirements are available for this section.' }) {
    if (!requirements.length) return <p className='summary-empty'>{empty}</p>
    return (
        <div className='requirement-list'>
            {requirements.map((requirement, index) => (
                <article className='requirement-item' key={(requirement.normalizedName || requirement.originalText || 'requirement') + '-' + index}>
                    <div className='summary-panel__heading'><h3>{requirement.originalText || requirement.normalizedName || 'Requirement'}</h3>{requirement.status && <span className='muted-badge'>{requirement.status}</span>}</div>
                    {requirement.explanation && <p>{requirement.explanation}</p>}
                    {Array.isArray(requirement.matchedEvidence) && requirement.matchedEvidence.length > 0 && <details className='requirement-evidence'><summary>Supporting evidence ({new Set(requirement.matchedEvidence.map(evidenceText)).size})</summary><ul className='summary-evidence'>{Array.from(new Set(requirement.matchedEvidence.map(evidenceText))).filter(Boolean).map((evidence, evidenceIndex) => <li key={evidence + '-' + evidenceIndex}>{evidence}</li>)}</ul></details>}
                </article>
            ))}
        </div>
    )
}

function SummarySection({ report }) {
    return <>
        <div className='summary-intro'><p className='summary-intro__eyebrow'>Overall assessment</p><p className='summary-intro__text'>{report.overallSummary || 'No overall assessment is available for this report.'}</p></div>
        <div className='summary-grid'>
            <section className='summary-panel'><div className='summary-panel__heading'><h2>Key strengths</h2><span className='muted-badge'>{report.strengths.length}</span></div><QualitativeList items={report.strengths} /></section>
            <section className='summary-panel'><div className='summary-panel__heading'><h2>Areas of improvement</h2><span className='muted-badge'>{report.areasOfImprovement.length}</span></div><QualitativeList items={report.areasOfImprovement} /></section>
        </div>
        <section className='summary-panel summary-panel--gaps'><div className='summary-panel__heading'><div><h2>Resume gaps</h2><p className='summary-panel__hint'>Only gaps recorded by the analysis are shown; absence of evidence is not treated as proof of absence.</p></div></div><QualitativeList items={report.resumeGaps} empty='No resume gaps were recorded.' /></section>
    </>
}

function SkillsSection({ report, selectedSkills, onToggle }) {
    const groups = [['Matched requirements', report.matchedRequirements], ['Partial requirements', report.partialRequirements], ['Missing requirements', report.missingRequirements], ['Needs verification', report.needsVerificationRequirements]]
    const missingSkills = report.missingRequirements.filter(item => ['programmingLanguage', 'frameworkOrLibrary', 'toolOrPlatform', 'database', 'other'].includes(item.category))
    return <div className='summary-item-list'>
        <section className='summary-panel'><div className='summary-panel__heading'><div><h2>Confirm skills</h2><p className='summary-panel__hint'>Know any of these skills? Select the ones you're familiar with to add them to your tailored resume.</p></div></div><div className='skill-gaps__list'>{missingSkills.map(skill => { const name = skill.normalizedName || skill.originalText; const checked = selectedSkills.has(name.toLowerCase()); return <label className={'skill-tag skill-tag--' + (checked ? 'low' : 'medium')} key={name}><input type='checkbox' checked={checked} onChange={() => onToggle(name)} />{name}</label> })}</div>{!missingSkills.length && <p className='summary-empty'>No selectable missing skills were recorded.</p>}</section>
        {selectedSkills.size > 0 && <section className='summary-panel'><div className='summary-panel__heading'><h2>Confirmed Skills</h2><span className='muted-badge'>{selectedSkills.size}</span></div><div className='skill-gaps__list'>{Array.from(selectedSkills).map(skill => <span className='skill-tag skill-tag--low' key={skill}>{skill}</span>)}</div></section>}
        {groups.map(([title, requirements]) => <section className='summary-panel' key={title}><div className='summary-panel__heading'><h2>{title}</h2><span className='muted-badge'>{requirements.length}</span></div><RequirementList requirements={requirements} /></section>)}
    </div>
}

function DetailSection({ title, body, requirements }) {
    return <>
        <section className='analysis-copy'><p className='summary-intro__eyebrow'>{title}</p><p className='summary-intro__text'>{textOf(body) || 'No qualitative analysis is available for this section.'}</p></section>
        {requirements && <section className='analysis-group'><div className='summary-panel__heading'><div><h2>Deterministic requirement evidence</h2><p className='summary-panel__hint'>Evidence is grouped by requirement and remains separate from the qualitative assessment.</p></div><span className='muted-badge'>{requirements.length}</span></div><RequirementList requirements={requirements} /></section>}
    </>
}

const CATEGORY_LABELS = {
    requiredTechnicalSkills: 'Technical skills',
    relevantProfessionalExperience: 'Relevant experience',
    toolsAndTechnologies: 'Tools & technologies',
    educationAndCertifications: 'Education & certifications',
}

function formatCategory(value) {
    return CATEGORY_LABELS[value] || String(value || 'Other').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
}

function formatScore(value) {
    return value == null || !Number.isFinite(Number(value)) ? '—' : Math.round(Number(value)) + '%'
}

function ScoreSidebar({ report, isDirty, saving, saveError, saveSuccess, onSave }) {
    const score = report.matchScore
    const gaps = [...report.partialRequirements, ...report.missingRequirements, ...report.needsVerificationRequirements]
    const eligibility = report.eligibility && typeof report.eligibility === 'object' && Object.keys(report.eligibility).length > 0 ? report.eligibility : null
    return <aside className='interview-sidebar'>
        <section className='overview-block'><h2>Overall match</h2><div className='overview-score'><div className='overview-score__ring' style={{ '--score': (score ?? 0) + '%' }}><div className='overview-score__inner'><strong className={score === null ? 'overview-score__placeholder' : ''}>{score === null ? '—' : Math.round(score)}<span className='overview-score__unit'>{score === null ? '' : '%'}</span></strong></div></div><span className='overview-score__caption'>{score === null ? 'Score unavailable' : 'Backend-calculated hiring fit'}</span></div></section>
        <div className='sidebar-divider' />
        <section className='overview-block'><div className='overview-block__heading'><h2>Category scores</h2></div>{report.categoryScores.length ? <div className='category-score-list'>{report.categoryScores.map((category) => <div className='category-score' key={category.category}><div className='category-score__header'><span title={formatCategory(category.category)}>{formatCategory(category.category)}</span><strong>{formatScore(category.score)}</strong></div><div className='category-score__track' role='progressbar' aria-label={formatCategory(category.category)} aria-valuenow={category.score == null ? undefined : Math.round(category.score)} aria-valuemin='0' aria-valuemax='100'><span style={{ width: category.score == null ? '0%' : Math.max(0, Math.min(100, Number(category.score))) + '%' }} /></div>{category.applicableRequirementCount != null && <small>{category.applicableRequirementCount} applicable requirement{category.applicableRequirementCount === 1 ? '' : 's'}</small>}</div>)}</div> : <p className='empty-state'>No category scores are available.</p>}</section>
        <div className='sidebar-divider' />
        <section className='overview-block'><div className='overview-block__heading'><h2>Critical skill gaps</h2><span className='muted-badge'>{gaps.length}</span></div>{gaps.length ? <ul className='gap-list'>{gaps.slice(0, 8).map((gap, index) => <li key={(gap.normalizedName || gap.originalText || 'gap') + '-' + index}><span>{gap.normalizedName || gap.originalText || 'Unspecified requirement'}</span><small className={'gap-status gap-status--' + gap.status}>{formatCategory(gap.status)}</small></li>)}</ul> : <p className='empty-state'>No critical gaps were recorded.</p>}</section>
        {eligibility && <><div className='sidebar-divider' /><section className='overview-block'><div className='overview-block__heading'><h2>Eligibility</h2></div><div className='eligibility-list'>{Object.entries(eligibility).map(([key, value]) => <div className='eligibility-row' key={key}><span>{key}</span><strong>{value?.status || value || 'Unknown'}</strong></div>)}</div></section></>}
        {isDirty && <section className='overview-block'><button className='button primary-button' type='button' disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save Changes'}</button>{saveError && <p className='empty-state'>{saveError}</p>}{saveSuccess && <p className='empty-state'>Changes saved.</p>}</section>}
    </aside>
}

export default function Interview() {
    const { interviewId } = useParams()
    const { report: rawReport, loading, getResumePdf, saveConfirmedSkills } = useInterview()
    const report = useMemo(() => adaptInterviewReport(rawReport), [rawReport])
    const [activeSection, setActiveSection] = useState('summary')
    const [selectedSkills, setSelectedSkills] = useState(new Set())
    const [savingSkills, setSavingSkills] = useState(false)
    const [generatingResume, setGeneratingResume] = useState(false)
    const [resumeDownloadError, setResumeDownloadError] = useState('')
    const resumeGenerationLock = useRef(false)
    const [saveError, setSaveError] = useState('')
    const [saveSuccess, setSaveSuccess] = useState(false)
    const savedSkills = useMemo(() => new Set(report?.confirmedSkills.map(skill => skill.normalizedName.toLowerCase()) || []), [report])
    useEffect(() => {
        if (report) setSelectedSkills(new Set(report.confirmedSkills.map(skill => skill.normalizedName.toLowerCase())))
        setSaveError('')
        setSaveSuccess(false)
    }, [report])
    if (!report) return <main className='loading-screen'><h1>Loading your resume analysis...</h1></main>
    const requirementsByCategory = (category) => report.requirements.filter((item) => item.scoringCategory === category || item.category === category)
    const isDirty = selectedSkills.size !== savedSkills.size || Array.from(selectedSkills).some(skill => !savedSkills.has(skill))
    const toggleSkill = (skill) => setSelectedSkills(previous => { const next = new Set(previous); const key = skill.toLowerCase(); if (next.has(key)) next.delete(key); else next.add(key); return next })
    const saveSkills = async () => {
        setSavingSkills(true); setSaveError(''); setSaveSuccess(false)
        try { await saveConfirmedSkills(interviewId, Array.from(selectedSkills)); setSaveSuccess(true) } catch { setSaveError('Unable to save changes. Please try again.') } finally { setSavingSkills(false) }
    }
    const downloadIdealResume = async () => {
        if (resumeGenerationLock.current) return
        resumeGenerationLock.current = true
        setGeneratingResume(true)
        setResumeDownloadError('')
        try {
            await getResumePdf(interviewId)
        } catch {
            setResumeDownloadError('Unable to generate your Ideal Resume. Please try again.')
        } finally {
            resumeGenerationLock.current = false
            setGeneratingResume(false)
        }
    }
    const section = { summary: <SummarySection report={report} />, skills: <SkillsSection report={report} selectedSkills={selectedSkills} onToggle={toggleSkill} />, experience: <DetailSection title='Experience alignment' body={report.experienceAlignment} requirements={requirementsByCategory('relevantProfessionalExperience')} />, education: <DetailSection title='Education & certifications' body={report.educationCertificationAnalysis} requirements={requirementsByCategory('educationAndCertifications')} />, quality: <DetailSection title='Resume quality' body={report.resumeQualityAnalysis} /> }[activeSection]
    return <main className='interview-page' aria-busy={loading}><div className='interview-layout'>
        <nav className='interview-nav' aria-label='Resume analysis sections'><div><div className='nav-heading'><span className='nav-heading__title'>Resume Analysis</span></div><div className='nav-items'>{NAV_ITEMS.map(([id, label]) => <button className={'interview-nav__item' + (activeSection === id ? ' interview-nav__item--active' : '')} key={id} type='button' onClick={() => setActiveSection(id)}><span>{label}</span></button>)}</div></div><div className='nav-actions'><button className='button primary-button' type='button' disabled={generatingResume} onClick={downloadIdealResume}>{generatingResume && <span className='button-spinner' aria-hidden='true' />}{generatingResume ? 'Generating…' : 'Download Ideal Resume'}</button>{generatingResume && <p className='download-status' role='status'>Generating your Ideal Resume. This usually takes a few seconds.</p>}{resumeDownloadError && <p className='download-status download-status--error' role='alert'>{resumeDownloadError}</p>}</div></nav>
        <div className='interview-divider' />
        <section className='interview-content'><header className='content-header'><div><p className='eyebrow'>Candidate report</p><h1>{NAV_ITEMS.find(([id]) => id === activeSection)?.[1]}</h1></div><span className='content-header__status'>{report.analysisVersion || 'Legacy report'}</span></header>{section}</section>
        <div className='interview-divider' /><ScoreSidebar report={report} isDirty={isDirty} saving={savingSkills} saveError={saveError} saveSuccess={saveSuccess} onSave={saveSkills} />
    </div></main>
}
