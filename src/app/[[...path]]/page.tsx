import { notFound, redirect } from "next/navigation";
import { getStore } from "@/lib/store";
import { identity, Fault } from "@/lib/server";
import {
  Home,
  ProductDetail,
  Cart,
  Checkout,
  Bulk,
  BannerStrip,
} from "@/components/storefront";
import { Catalogue } from "@/components/catalogue";
import { AuthForm, Mfa } from "@/components/auth-form";
import { Account } from "@/components/account";
import { OrderView } from "@/components/order-view";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{
    path?: string[];
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path = [] } = await params;
  const route = path.join("/");
  const store = await getStore();
  if (route === "") return <Home {...store} />;
  if (route === "shop") {
    const q = await searchParams;
    return (
      <>
        <header className="page-heading">
          <span className="eyebrow">Silk, cotton, bridal and so much more</span>
          <h1>All sarees.</h1>
          <p>A colour for every mood. A saree for every day.</p>
        </header>
        <BannerStrip
          banners={store.banners.filter((b) => b.position === "shop")}
        />
        <section className="section shop-section">
          <Catalogue
            products={store.products}
            ordering={store.settings.ordering_enabled}
            initialCategory={
              typeof q.category === "string" ? q.category : "All"
            }
          />
        </section>
      </>
    );
  }
  if (path[0] === "products" && path.length === 2) {
    const p = store.products.find((p) => p.slug === path[1]);
    if (!p) notFound();
    return <ProductDetail p={p} settings={store.settings} />;
  }
  if (route === "cart") return <Cart {...store} />;
  if (route === "bulk") return <Bulk settings={store.settings} />;
  if (["login", "register", "forgot-password"].includes(route))
    return <AuthForm mode={route} />;
  if (
    ["checkout", "mfa", "reset-password", "account"].includes(route) ||
    (path[0] === "account" && path[1] === "orders" && path.length === 3)
  ) {
    let session;
    try {
      session = await identity();
    } catch (e) {
      if (e instanceof Fault && e.code === "SETUP_REQUIRED")
        return (
          <section className="section narrow">
            <h1>Store setup.</h1>
            <p>
              The catalogue is ready to preview. Connect Supabase using the
              included setup guide before signing in or taking orders.
            </p>
          </section>
        );
      redirect("/login");
    }
    if (route === "checkout") return <Checkout {...store} />;
    if (route === "mfa") return <Mfa />;
    if (route === "reset-password") return <AuthForm mode={route} />;
    if (route === "account")
      return (
        <Account
          profile={session.profile}
          products={store.products}
          ordering={store.settings.ordering_enabled}
        />
      );
    if (!/^[0-9a-f-]{36}$/i.test(path[2])) notFound();
    return <OrderView id={path[2]} />;
  }
  notFound();
}
