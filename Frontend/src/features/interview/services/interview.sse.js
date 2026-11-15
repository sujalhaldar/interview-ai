export function createSseParser({ onProgress, onError }) {
    let buffer = ""
    let completed = null
    const consume = (chunk) => {
        buffer += chunk
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() || ""
        for (const raw of events) {
            let event = "message"
            const data = raw.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n")
            for (const line of raw.split(/\r?\n/)) if (line.startsWith("event:")) event = line.slice(6).trim()
            if (!data) continue
            let payload
            try { payload = JSON.parse(data) } catch { continue }
            if (event === "progress") onProgress?.(payload)
            else if (event === "error") onError?.(payload)
            else if (event === "complete") completed = payload.interviewReport
        }
    }
    return { consume, finish: () => { consume("\n\n"); return completed } }
}
