// Render serves the frontend and order API from the same domain.
// Use the current site origin so the Mini App submits orders to this Render service.
window.SALSACOS_API_URL = window.location.origin;
