import { createBrowserRouter, Navigate } from "react-router";
import Login from "./features/auth/pages/Login";
import Protected from "./features/auth/components/Protected";
import Home from "./features/interview/pages/Home";
import Interview from "./features/interview/pages/Interview";
import AuthenticatedShell from "./features/auth/components/AuthenticatedShell";


export const router = createBrowserRouter([
    {
        path: "/login",
        element: <Login />
    },
    {
        path: "/register",
        element: <Navigate to="/login" replace />
    },
    {
        path: "/",
        element: <Protected><AuthenticatedShell><Home /></AuthenticatedShell></Protected>
    },
    {
        path:"/interview/:interviewId",
        element: <Protected><AuthenticatedShell><Interview /></AuthenticatedShell></Protected>
    }
])
