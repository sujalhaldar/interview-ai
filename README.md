# Interview AI

## Authentication

Interview AI uses Google Sign-In. The frontend receives a Google ID token and sends it to the backend, which verifies the token and issues an application JWT in an HttpOnly cookie. The Google ID token is used only for sign-in; it is not the application session credential.

Authenticated requests are validated through the application JWT session. Logging out invalidates the current application session and clears its cookie.
