export function adaptInterviewReport(report) {
    if (!report) return null
    const v2 = report.analysisVersion === '2.0'
    const legacyCategoryScores = Array.isArray(report.categoryAssessments)
        ? report.categoryAssessments.map(({ category, score }) => ({ category, score, applicableRequirementCount: null }))
        : []
    const requirements = report.requirementAnalysis?.requirements || []
    const groups = report.requirementAnalysis || {}
    return {
        ...report,
        isV2: v2,
        matchScore: Number.isFinite(report.matchScore) ? report.matchScore : null,
        categoryScores: Array.isArray(report.categoryScores) ? report.categoryScores : legacyCategoryScores,
        requirements,
        matchedRequirements: groups.matchedRequirements || [],
        partialRequirements: groups.partialRequirements || [],
        missingRequirements: groups.missingRequirements || [],
        needsVerificationRequirements: groups.needsVerificationRequirements || [],
        strengths: Array.isArray(report.strengths) ? report.strengths : [],
        areasOfImprovement: Array.isArray(report.areasOfImprovement) ? report.areasOfImprovement : [],
        resumeGaps: Array.isArray(report.resumeGaps) ? report.resumeGaps : [],
        skillGaps: Array.isArray(report.skillGaps) ? report.skillGaps : [],
        confirmedSkills: Array.isArray(report.confirmedSkills) ? report.confirmedSkills : []
    }
}
