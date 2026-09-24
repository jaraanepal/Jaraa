/**
 * Legacy page path — /admin now renders the admin dashboard.
 * Kept as a thin re-export so nothing that imports "./pages/Admin"
 * (routes, tests) breaks.
 */
export { default } from "./admin/AdminDashboard";
