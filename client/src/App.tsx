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
const Admin = lazy(() => import("./pages/Admin"));
const AdminKits = lazy(() => import("./pages/admin/AdminKits"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminFlags = lazy(() => import("./pages/admin/AdminFlags"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const Pharmacy = lazy(() => import("./pages/Pharmacy"));
const Coach = lazy(() => import("./pages/Coach"));
const CoachFollowups = lazy(() => import("./pages/Coach").then((m) => ({ default: m.CoachFollowups })));

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

                  {/* Role consoles */}
                  <Route path="/doctor" element={<Guard><DoctorDashboard /></Guard>} />
                  <Route path="/doctor/reviewed" element={<Guard><DoctorDashboard initialTab="reviewed" /></Guard>} />
                  <Route path="/doctor/profile" element={<Guard><StaffProfile /></Guard>} />
                  <Route path="/doctor/case/:id" element={<Guard><DoctorCase /></Guard>} />
                  <Route path="/admin" element={<Guard><Admin /></Guard>} />
                  <Route path="/admin/kits" element={<Guard><AdminKits /></Guard>} />
                  <Route path="/admin/orders" element={<Guard><AdminOrders /></Guard>} />
                  <Route path="/admin/users" element={<Guard><AdminUsers /></Guard>} />
                  <Route path="/admin/flags" element={<Guard><AdminFlags /></Guard>} />
                  <Route path="/admin/audit" element={<Guard><AdminAudit /></Guard>} />
                  <Route path="/admin/profile" element={<Guard><StaffProfile /></Guard>} />
                  <Route path="/pharmacy" element={<Guard><Pharmacy /></Guard>} />
                  <Route path="/pharmacy/profile" element={<Guard><StaffProfile /></Guard>} />
                  <Route path="/coach" element={<Guard><Coach /></Guard>} />
                  <Route path="/coach/followups" element={<Guard><CoachFollowups /></Guard>} />
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
