import { useAuth } from "../auth/AuthContext";
import Profile from "./Profile";
import StaffProfile from "./staff/StaffProfile";

/**
 * /profile is role-aware: customers get the full customer profile
 * (photo, details, addresses); staff get the staff profile.
 * The bottom nav "Profile" tab works for every role.
 */
export default function ProfileShell() {
  const { role } = useAuth();
  if (role && role !== "customer") return <StaffProfile />;
  return <Profile />;
}
