import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { staff, Fault } from "@/lib/server";
import { adminNav } from "@/lib/admin-fields";
import { ERP } from "@/components/erp";
import { erpModules } from "@/lib/erp-fields";
import { Admin } from "@/components/admin";
import { POSBillingDashboard } from "@/components/erp/staff-billing";

export default async function AdminPage({
  params,
}: {
  params: Promise<{
    section?: string[];
  }>;
}) {
  const { section = [] } = await params;
  if (
    section.length > 2 ||
    (section.length === 2 &&
      (section[0] !== "orders" || !/^[a-f0-9-]{36}$/i.test(section[1]))) ||
    !adminNav.some(([s]) => s === (section[0] || ""))
  )
    notFound();
  try {
    const requiredCap =
      section.length && erpModules[section[0]]
        ? (erpModules[section[0]].cap as any)
        : undefined;
    const session = await staff(requiredCap);

    // Dedicated workspace for billing staff:
    // /admin or /admin/dashboard -> Cashier POS Billing Dashboard
    // /admin/pos -> POS billing checkout register
    // /admin/expenses -> Shop petty cash expenses
    if (session.profile.role === "billing") {
      if (!section.length || section[0] === "dashboard") {
        return (
          <Suspense fallback={null}>
            <POSBillingDashboard profile={session.profile} />
          </Suspense>
        );
      }
      if (section[0] === "pos" || section[0] === "expenses") {
        return (
          <Suspense fallback={null}>
            <ERP module={section[0]} profile={session.profile} />
          </Suspense>
        );
      }
      throw new Fault(403, "FORBIDDEN");
    }

    if (erpModules[section[0]]) {
      return (
        <Suspense fallback={null}>
          <ERP module={section[0]} profile={session.profile} />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={null}>
        <Admin
          section={section[0] || ""}
          orderId={section[1]}
          profile={session.profile}
        />
      </Suspense>
    );
  } catch (e) {
    if (e instanceof Fault) {
      if (e.code === "MFA_REQUIRED") redirect("/mfa");
      if (e.status === 401) redirect("/login");
      return (
        <section className="section narrow">
          <h1>Staff access.</h1>
          <p>
            {e.code === "SETUP_REQUIRED"
              ? "Connect Supabase and create your first administrator using the setup guide."
              : "This account does not have staff access."}
          </p>
        </section>
      );
    }
    throw e;
  }
}
