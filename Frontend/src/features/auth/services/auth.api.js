import axios from "axios"
import { API_BASE_URL } from "../../../config/api.js"


const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true
})

export async function googleLogin(idToken) {
    const response = await api.post("/api/auth/google", { idToken })
    return response.data
}

export async function logout() {
    const response = await api.post("/api/auth/logout")
    return response.data
}

export async function getMe() {
    const response = await api.get("/api/auth/get-me")
    return response.data

}
