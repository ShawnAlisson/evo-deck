import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/workspaces");
  return (
    <div className="auth-screen">
      <AuthForm mode="signup" />
    </div>
  );
}
