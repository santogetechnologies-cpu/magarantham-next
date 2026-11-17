import { notFound, redirect } from "next/navigation";
import { staff, Fault } from "@/lib/server";
import { adminNav } from "@/lib/admin-fields";
import {ERP} from "@/components/erp";
import {erpModules} from "@/lib/erp-fields";
import { Admin } from "@/components/admin";
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
    let session = await staff();
    if(session.profile.role==='billing'&&!section.length)redirect('/admin/pos');
    if(erpModules[section[0]]){session=await staff(erpModules[section[0]].cap as any);return <ERP module={section[0]} profile={session.profile}/>;}
    if(session.profile.role==='billing')throw new Fault(403,'FORBIDDEN');
    return (
      <Admin
        section={section[0] || ""}
        orderId={section[1]}
        profile={session.profile}
      />
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
