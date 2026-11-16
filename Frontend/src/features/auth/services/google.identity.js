const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client"
let scriptPromise

export function loadGoogleIdentityServices() {
    if (typeof window === "undefined") return Promise.reject(new Error("Google Sign-In is unavailable."))
    if (window.google?.accounts?.id) return Promise.resolve(window.google)
    if (scriptPromise) return scriptPromise
    scriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`)
        const complete = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error("Google Sign-In could not be initialized."))
        if (existing) {
            existing.addEventListener("load", complete, { once: true })
            existing.addEventListener("error", () => reject(new Error("Google Sign-In could not be loaded.")), { once: true })
            return
        }
        const script = document.createElement("script")
        script.src = GOOGLE_SCRIPT_SRC; script.async = true; script.defer = true
        script.onload = complete
        script.onerror = () => { scriptPromise = undefined; reject(new Error("Google Sign-In could not be loaded.")) }
        document.head.appendChild(script)
    })
    return scriptPromise
}
