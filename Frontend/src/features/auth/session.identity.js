let expectedUserId = null

export const setExpectedUserId = (userId) => {
    expectedUserId = userId ? String(userId) : null
}

export const getExpectedUserId = () => expectedUserId
