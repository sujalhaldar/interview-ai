import { useEffect, useRef } from "react"

const NetworkParticleBackground = () => {
    const canvasRef = useRef(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext("2d", { alpha: false })
        if (!canvas || !context) return undefined

        const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
        let width = 0
        let height = 0
        let columns = 0
        let rows = 0
        let maxDistance = 0
        let particles = []
        let grid = []
        let frame = 0

        const makeField = () => {
            width = window.innerWidth
            height = window.innerHeight
            const pixelRatio = Math.min(window.devicePixelRatio || 1, width < 640 ? 1.5 : 2)
            canvas.width = Math.round(width * pixelRatio)
            canvas.height = Math.round(height * pixelRatio)
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

            const spacing = width < 640 ? 64 : Math.max(36, Math.min(64, Math.sqrt(width * height / 1100)))
            columns = Math.ceil(width / spacing) + 1
            rows = Math.ceil(height / spacing) + 1
            maxDistance = spacing * 1.6
            grid = new Array(columns * rows).fill(null)
            particles = []

            for (let row = 0; row < rows; row += 1) {
                for (let column = 0; column < columns; column += 1) {
                    const depth = row / Math.max(1, rows - 1)
                    const density = 0.68 + 0.13 * Math.sin(column * 0.28 + Math.sin(row * 0.34 + column * 0.08) * 1.6) + depth * 0.12
                    if (Math.random() > density) continue

                    const x = (column + 0.5 + (row % 2) * 0.5 + (Math.random() - 0.5) * 0.4) * spacing
                    const y = (row + 0.5 + (Math.random() - 0.5) * 0.4) * spacing
                    const particle = {
                        originX: x,
                        originY: y,
                        x,
                        y,
                        phase: column * 0.12 + row * 0.19 + Math.random() * 0.45,
                        radius: 0.65 + Math.random() * 0.55,
                        alpha: 0.15 + depth * 0.18 + Math.random() * 0.15,
                        glow: Math.random() > 0.94
                    }
                    particles.push(particle)
                    grid[row * columns + column] = particle
                }
            }
        }

        const draw = (timestamp = 0) => {
            if (document.hidden) return
            const time = motionPreference.matches ? 0 : timestamp * 0.001
            context.clearRect(0, 0, width, height)

            for (const particle of particles) {
                particle.x = particle.originX
                    + Math.sin(time * 0.24 + particle.originY * 0.008 + particle.originX * 0.002) * 18
                particle.y = particle.originY
                    + Math.sin(time * 0.32 + particle.originX * 0.005 + particle.originY * 0.002) * 84
                    + Math.sin(time * 0.18 + particle.originY * 0.005 - particle.originX * 0.003) * 34
                    + Math.sin(time * 0.36 + particle.phase) * 2.5
            }

            context.strokeStyle = "#aab8c9"
            context.lineWidth = 0.65
            for (let row = 0; row < rows; row += 1) {
                for (let column = 0; column < columns; column += 1) {
                    const particle = grid[row * columns + column]
                    if (!particle) continue

                    for (let neighborRow = Math.max(0, row - 2); neighborRow <= Math.min(rows - 1, row + 2); neighborRow += 1) {
                        for (let neighborColumn = Math.max(0, column - 2); neighborColumn <= Math.min(columns - 1, column + 2); neighborColumn += 1) {
                            if (neighborRow < row || (neighborRow === row && neighborColumn <= column)) continue
                            const neighbor = grid[neighborRow * columns + neighborColumn]
                            if (!neighbor) continue

                            const dx = neighbor.x - particle.x
                            const dy = neighbor.y - particle.y
                            const distance = Math.sqrt(dx * dx + dy * dy)
                            if (distance >= maxDistance) continue

                            context.globalAlpha = (1 - distance / maxDistance) * 0.24
                            context.beginPath()
                            context.moveTo(particle.x, particle.y)
                            context.lineTo(neighbor.x, neighbor.y)
                            context.stroke()
                        }
                    }
                }
            }

            context.fillStyle = "#dce5ef"
            for (const particle of particles) {
                context.globalAlpha = particle.alpha
                context.beginPath()
                context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
                context.fill()

                if (particle.glow) {
                    context.globalAlpha = particle.alpha * 0.3
                    context.beginPath()
                    context.arc(particle.x, particle.y, particle.radius * 3.2, 0, Math.PI * 2)
                    context.fill()
                }
            }
            context.globalAlpha = 1

            if (!motionPreference.matches) frame = window.requestAnimationFrame(draw)
        }

        const stop = () => {
            if (frame) window.cancelAnimationFrame(frame)
            frame = 0
        }
        const start = () => {
            if (document.hidden || motionPreference.matches || frame) return
            frame = window.requestAnimationFrame(draw)
        }
        const handleResize = () => {
            makeField()
            if (motionPreference.matches) draw(0)
        }
        const handleVisibilityChange = () => {
            if (document.hidden) stop()
            else if (motionPreference.matches) draw(0)
            else start()
        }
        const handleMotionChange = () => {
            stop()
            if (motionPreference.matches) draw(0)
            else start()
        }

        makeField()
        if (motionPreference.matches) draw(0)
        else start()
        window.addEventListener("resize", handleResize)
        document.addEventListener("visibilitychange", handleVisibilityChange)
        motionPreference.addEventListener("change", handleMotionChange)

        return () => {
            stop()
            window.removeEventListener("resize", handleResize)
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            motionPreference.removeEventListener("change", handleMotionChange)
        }
    }, [])

    return <canvas className="auth-network-canvas" ref={canvasRef} aria-hidden="true" />
}

export default NetworkParticleBackground
