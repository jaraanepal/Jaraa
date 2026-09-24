import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "./i18n/LanguageContext";
import { AuthProvider } from "./auth/AuthContext";
import { FlagsProvider } from "./auth/FlagsContext";
import Layout from "./components/Layout";
import { ForbiddenPage, Guard, NotFoundPage } from "./components/Guard";
import { Loading } from "./components/ui";
import { draftHasProgress, loadDraft } from "./lib/draft";
import Home from "./pages/Home";

const Login = lazy(() => import("./pages/Login"));
const ScanShell = lazy(() => import("./pages/scan/ScanShell"));
const RootMap = lazy(() => import("./pages/scan/RootMap"));
const SubmitScan = lazy(() => import("./pages/scan/SubmitScan"));
const Plan = lazy(() => import("./pages/Plan"));
const Progress = lazy(() => import("./pages/Progress"));
const Kits = lazy(() => import("./pages/Kits"));
const Orders = lazy(() => import("./pages/Orders"));
const Teleconsult = lazy(() => import("./pages/Teleconsult"));
const DoctorQueue = lazy(() => import("./pages/doctor/DoctorQueue"));
const DoctorCase = lazy(() => import("./pages/doctor/DoctorCase"));
const Admin = lazy(() => import("./pages/Admin"));
const Pharmacy = lazy(() => import("./pages/Pharmacy"));
const Coach = lazy(() => import("./pages/Coach"));

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
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/login" element={<Login />} />

                  {/* Customer */}
                  <Route path="/" element={<Guard><Home /></Guard>} />
                  <Route path="/scan" element={<Guard><ScanStart /></Guard>} />
                  <Route path="/scan/:id" element={<Guard><ScanShell /></Guard>} />
                  <Route path="/scan/:id/map" element={<Guard><RootMap /></Guard>} />
                  <Route path="/scan/:id/submit" element={<Guard><SubmitScan /></Guard>} />
                  <Route path="/plan" element={<Guard><Plan /></Guard>} />
                  <Route path="/progress" element={<Guard><Progress /></Guard>} />
                  <Route path="/kits" element={<Guard><Kits /></Guard>} />
                  <Route path="/orders" element={<Guard><Orders /></Guard>} />
                  <Route path="/teleconsult" element={<Guard><Teleconsult /></Guard>} />

                  {/* Role consoles */}
                  <Route path="/doctor" element={<Guard><DoctorQueue /></Guard>} />
                  <Route path="/doctor/case/:id" element={<Guard><DoctorCase /></Guard>} />
                  <Route path="/admin" element={<Guard><Admin /></Guard>} />
                  <Route path="/pharmacy" element={<Guard><Pharmacy /></Guard>} />
                  <Route path="/coach" element={<Guard><Coach /></Guard>} />

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
