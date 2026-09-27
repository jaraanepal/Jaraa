import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "./i18n/LanguageContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { FlagsProvider } from "./auth/FlagsContext";
import Layout from "./components/Layout";
import { ForbiddenPage, Guard, NotFoundPage } from "./components/Guard";
import { Loading } from "./components/ui";
import Splash from "./components/Splash";
import { draftHasProgress, loadDraft } from "./lib/draft";
import Home from "./pages/Home";

const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const StaffLogin = lazy(() => import("./pages/StaffLogin"));
const ProfileShell = lazy(() => import("./pages/ProfileShell"));
const StaffProfile = lazy(() => import("./pages/staff/StaffProfile"));
const ScanShell = lazy(() => import("./pages/scan/ScanShell"));
const RootMap = lazy(() => import("./pages/scan/RootMap"));
const SubmitScan = lazy(() => import("./pages/scan/SubmitScan"));
const Plan = lazy(() => import("./pages/Plan"));
const Progress = lazy(() => import("./pages/Progress"));
const Kits = lazy(() => import("./pages/Kits"));
const KitDetail = lazy(() => import("./pages/KitDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const Teleconsult = lazy(() => import("./pages/Teleconsult"));
const Notifications = lazy(() => import("./pages/Notifications"));
const DoctorDashboard = lazy(() => import("./pages/doctor/DoctorDashboard"));
const DoctorCase = lazy(() => import("./pages/doctor/DoctorCase"));
const DoctorTools = lazy(() => import("./pages/doctor/DoctorTools"));
const AdminTools = lazy(() => import("./pages/admin/AdminTools"));
const PharmacyTools = lazy(() => import("./pages/pharmacy/PharmacyTools"));
const CoachTools = lazy(() => import("./pages/coach/CoachTools"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminKits = lazy(() => import("./pages/admin/AdminKits"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders"));
const AdminPayouts = lazy(() => import("./pages/admin/AdminPayouts"));
const AdminPlanTemplates = lazy(() => import("./pages/admin/AdminPlanTemplates"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminFlags = lazy(() => import("./pages/admin/AdminFlags"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminBroadcast = lazy(() => import("./pages/admin/AdminBroadcast"));
const AdminRefunds = lazy(() => import("./pages/admin/AdminRefunds"));
const AdminSla = lazy(() => import("./pages/admin/AdminSla"));
const AdminVerifications = lazy(() => import("./pages/admin/AdminVerifications"));
const AdminFinance = lazy(() => import("./pages/admin/AdminFinance"));
const AdminTickets = lazy(() => import("./pages/admin/AdminTickets"));
const AdminArticles = lazy(() => import("./pages/admin/AdminArticles"));
const AdminKitAnalytics = lazy(() => import("./pages/admin/AdminKitAnalytics"));
const AdminCases = lazy(() => import("./pages/admin/AdminCases"));
const Pharmacy = lazy(() => import("./pages/Pharmacy"));
const Coach = lazy(() => import("./pages/Coach"));
const CoachFollowups = lazy(() => import("./pages/Coach").then((m) => ({ default: m.CoachFollowups })));
/* v14: pharmacy section pages (Problem 2) + coach customer workflow (Problem 4) */
const lazySection = (name: keyof typeof import("./pages/pharmacy/sections")) =>
  lazy(() => import("./pages/pharmacy/sections").then((m) => ({ default: m[name] })));
const PharmacyQueuePage = lazySection("PharmacyQueuePage");
const PharmacyStockPage = lazySection("PharmacyStockPage");
const PharmacyManifestPage = lazySection("PharmacyManifestPage");
const PharmacyExpiryPage = lazySection("PharmacyExpiryPage");
const PharmacyClaimsPage = lazySection("PharmacyClaimsPage");
const PharmacyHolidaysPage = lazySection("PharmacyHolidaysPage");
const PharmacyReportsPage = lazySection("PharmacyReportsPage");
const PharmacyPerformancePage = lazySection("PharmacyPerformancePage");
const PharmacyQuarantinePage = lazySection("PharmacyQuarantinePage");
const PharmacyShiftPage = lazySection("PharmacyShiftPage");
const PharmacyCouriersPage = lazySection("PharmacyCouriersPage");
const PharmacyReturnsPage = lazySection("PharmacyReturnsPage");
const PharmacyPackagingPage = lazySection("PharmacyPackagingPage");
const PharmacyCodPage = lazySection("PharmacyCodPage");
const CoachCustomers = lazy(() => import("./pages/coach/CoachCustomers"));
const CoachCustomerDetail = lazy(() => import("./pages/coach/CoachCustomerDetail"));
/* P-12 customer feature pages */
const Habits = lazy(() => import("./pages/Habits"));
const Referral = lazy(() => import("./pages/Referral"));
const Wishlist = lazy(() => import("./pages/Wishlist"));
const Help = lazy(() => import("./pages/Help"));
const MyData = lazy(() => import("./pages/MyData"));
const MyChallenges = lazy(() => import("./pages/MyChallenges"));

/**
 * Bare /scan entry: resumes the local draft scan, or sends the customer
 * back home to start a new one. Guests may hold a draft without auth.
 */
function ScanStart() {
  const d = loadDraft();
  const resumable = draftHasProgress(d) && d.scanId;
  return <Navigate to={resumable ? `/scan/${d.scanId}` : "/"} replace />;
}

/**
 * Cold-start splash. Shows once per app launch — App mounts exactly once
 * per page load, so this never re-triggers on in-app navigation. Dismisses
 * when the auth restore finishes (>=1.8s shown, hard cap ~3s).
 */
function ColdStartSplash() {
  const { authReady } = useAuth();
  const [done, setDone] = useState(false);
  if (done) return null;
  return <Splash ready={authReady} onDone={() => setDone(true)} />;
}

/**
 * Route tree. Access control lives in <Guard> (lib/guards.ts), which reads
 * the JWT role and the guest-draft state; Layout renders the app chrome
 * (topbar, escape hatch, bottom nav) around every page via <Outlet/>.
 */
export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <FlagsProvider>
          <BrowserRouter>
            <ColdStartSplash />
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route element={<Layout />}>
                  {/* Auth — same pages/flow for every role */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />

                  {/* Dedicated staff logins — never the customer OTP flow */}
                  <Route path="/admin/login" element={<StaffLogin role="admin" />} />
                  <Route path="/doctor/login" element={<StaffLogin role="doctor" />} />
                  <Route path="/pharmacy/login" element={<StaffLogin role="pharmacy" />} />
                  <Route path="/coach/login" element={<StaffLogin role="coach" />} />

                  {/* Role-aware: customers get the full profile, staff get theirs */}
                  <Route path="/profile" element={<Guard><ProfileShell /></Guard>} />

                  {/* Customer */}
                  <Route path="/" element={<Guard><Home /></Guard>} />
                  <Route path="/scan" element={<Guard><ScanStart /></Guard>} />
                  <Route path="/scan/:id" element={<Guard><ScanShell /></Guard>} />
                  <Route path="/scan/:id/map" element={<Guard><RootMap /></Guard>} />
                  <Route path="/scan/:id/submit" element={<Guard><SubmitScan /></Guard>} />
                  <Route path="/plan" element={<Guard><Plan /></Guard>} />
                  <Route path="/progress" element={<Guard><Progress /></Guard>} />
                  <Route path="/kits" element={<Guard><Kits /></Guard>} />
                  <Route path="/kits/:id" element={<Guard><KitDetail /></Guard>} />
                  <Route path="/orders" element={<Guard><Orders /></Guard>} />
                  <Route path="/teleconsult" element={<Guard><Teleconsult /></Guard>} />
                  <Route path="/notifications" element={<Guard><Notifications /></Guard>} />
                  {/* P-12 customer features */}
                  <Route path="/habits" element={<Guard><Habits /></Guard>} />
                  <Route path="/referral" element={<Guard><Referral /></Guard>} />
                  <Route path="/wishlist" element={<Guard><Wishlist /></Guard>} />
                  <Route path="/help" element={<Guard><Help /></Guard>} />
                  <Route path="/my-data" element={<Guard><MyData /></Guard>} />
                  <Route path="/my-challenges" element={<Guard><MyChallenges /></Guard>} />

                  {/* Role consoles */}
                  <Route path="/doctor" element={<Guard><DoctorDashboard /></Guard>} />
                  <Route path="/doctor/reviewed" element={<Guard><DoctorDashboard initialTab="reviewed" /></Guard>} />
                  <Route path="/doctor/patients" element={<Guard><DoctorDashboard initialTab="patients" /></Guard>} />
                  <Route path="/doctor/followups" element={<Guard><DoctorDashboard initialTab="followups" /></Guard>} />
                  <Route path="/doctor/availability" element={<Guard><DoctorDashboard initialTab="availability" /></Guard>} />
                  <Route path="/doctor/activity" element={<Guard><DoctorDashboard initialTab="activity" /></Guard>} />
                  <Route path="/doctor/archived" element={<Guard><DoctorDashboard initialTab="archived" /></Guard>} />
                  <Route path="/doctor/second-opinions" element={<Guard><DoctorDashboard initialTab="secondops" /></Guard>} />
                  <Route path="/doctor/calendar" element={<Guard><DoctorDashboard initialTab="calendar" /></Guard>} />
                  <Route path="/doctor/triage-presets" element={<Guard><DoctorDashboard initialTab="presets" /></Guard>} />
                  <Route path="/doctor/digest" element={<Guard><DoctorDashboard initialTab="digest" /></Guard>} />
                  <Route path="/doctor/profile" element={<Guard><StaffProfile /></Guard>} />
                  <Route path="/doctor/case/:id" element={<Guard><DoctorCase /></Guard>} />
                  <Route path="/doctor/tools" element={<Guard><DoctorTools /></Guard>} />
                  <Route path="/admin" element={<Guard><Admin /></Guard>} />
                  <Route path="/admin/kits" element={<Guard><AdminKits /></Guard>} />
                  <Route path="/admin/orders" element={<Guard><AdminOrders /></Guard>} />
                  <Route path="/admin/payouts" element={<Guard><AdminPayouts /></Guard>} />
                  <Route path="/admin/plan-templates" element={<Guard><AdminPlanTemplates /></Guard>} />
                  <Route path="/admin/users" element={<Guard><AdminUsers /></Guard>} />
                  <Route path="/admin/flags" element={<Guard><AdminFlags /></Guard>} />
                  <Route path="/admin/audit" element={<Guard><AdminAudit /></Guard>} />
                  <Route path="/admin/broadcast" element={<Guard><AdminBroadcast /></Guard>} />
                  <Route path="/admin/refunds" element={<Guard><AdminRefunds /></Guard>} />
                  <Route path="/admin/sla" element={<Guard><AdminSla /></Guard>} />
                  <Route path="/admin/verifications" element={<Guard><AdminVerifications /></Guard>} />
                  <Route path="/admin/finance" element={<Guard><AdminFinance /></Guard>} />
                  <Route path="/admin/tickets" element={<Guard><AdminTickets /></Guard>} />
                  <Route path="/admin/articles" element={<Guard><AdminArticles /></Guard>} />
                  <Route path="/admin/cases" element={<Guard><AdminCases /></Guard>} />
                  <Route path="/admin/kit-analytics" element={<Guard><AdminKitAnalytics /></Guard>} />
                  <Route path="/admin/profile" element={<Guard><StaffProfile /></Guard>} />
                  <Route path="/admin/tools" element={<Guard><AdminTools /></Guard>} />
                  <Route path="/pharmacy" element={<Guard><Pharmacy /></Guard>} />
                  {/* v14: one sidebar page per pharmacy tool area (Problem 2) */}
                  <Route path="/pharmacy/queue" element={<Guard><PharmacyQueuePage /></Guard>} />
                  <Route path="/pharmacy/stock" element={<Guard><PharmacyStockPage /></Guard>} />
                  <Route path="/pharmacy/manifest" element={<Guard><PharmacyManifestPage /></Guard>} />
                  <Route path="/pharmacy/expiry" element={<Guard><PharmacyExpiryPage /></Guard>} />
                  <Route path="/pharmacy/claims" element={<Guard><PharmacyClaimsPage /></Guard>} />
                  <Route path="/pharmacy/holidays" element={<Guard><PharmacyHolidaysPage /></Guard>} />
                  <Route path="/pharmacy/reports" element={<Guard><PharmacyReportsPage /></Guard>} />
                  <Route path="/pharmacy/performance" element={<Guard><PharmacyPerformancePage /></Guard>} />
                  <Route path="/pharmacy/quarantine" element={<Guard><PharmacyQuarantinePage /></Guard>} />
                  <Route path="/pharmacy/shift" element={<Guard><PharmacyShiftPage /></Guard>} />
                  <Route path="/pharmacy/couriers" element={<Guard><PharmacyCouriersPage /></Guard>} />
                  <Route path="/pharmacy/returns" element={<Guard><PharmacyReturnsPage /></Guard>} />
                  <Route path="/pharmacy/packaging" element={<Guard><PharmacyPackagingPage /></Guard>} />
                  <Route path="/pharmacy/cod" element={<Guard><PharmacyCodPage /></Guard>} />
                  <Route path="/pharmacy/tools" element={<Guard><PharmacyTools /></Guard>} />
                  <Route path="/pharmacy/profile" element={<Guard><StaffProfile /></Guard>} />
                  <Route path="/coach" element={<Guard><Coach /></Guard>} />
                  {/* v14: coach customer workflow (Problem 4) */}
                  <Route path="/coach/customers" element={<Guard><CoachCustomers /></Guard>} />
                  <Route path="/coach/customers/:id" element={<Guard><CoachCustomerDetail /></Guard>} />
                  <Route path="/coach/followups" element={<Guard><CoachFollowups /></Guard>} />
                  <Route path="/coach/tools" element={<Guard><CoachTools /></Guard>} />
                  <Route path="/coach/profile" element={<Guard><StaffProfile /></Guard>} />

                  {/* Errors */}
                  <Route path="/403" element={<ForbiddenPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </FlagsProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
