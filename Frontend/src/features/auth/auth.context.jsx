import { createContext, useCallback, useRef, useState } from "react";


export const AuthContext = createContext()


export const AuthProvider = ({ children }) => {

    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const transitionGeneration = useRef(0)
    const beginTransition = useCallback(() => {
        transitionGeneration.current += 1
        return transitionGeneration.current
    }, [])
    const isCurrentTransition = useCallback(generation => generation === transitionGeneration.current, [])

    return (
        <AuthContext.Provider value={{user,setUser,loading,setLoading,beginTransition,isCurrentTransition}} >
            {children}
        </AuthContext.Provider>
    )


}
