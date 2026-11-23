import { notFound, redirect } from "next/navigation";
import { getStore } from "@/lib/store";
import { identity, Fault } from "@/lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
import {
  Home,
  ProductDetail,
  Cart,
  Checkout,
  Bulk,
} from "@/components/storefront";
import { BannerSlot } from "@/components/banner-slot";
import { Catalogue } from "@/components/catalogue";
import { AuthForm, Mfa } from "@/components/auth-form";
import { Account } from "@/components/account";
import { OrderView } from "@/components/order-view";
import { CategoryCollectionPage } from "@/components/category-collection";
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
        <BannerSlot banners={store.banners} position="shop" />
        <section className="section shop-section">
          <Catalogue
            products={store.products}
            categories={store.categories}
            ordering={store.settings.ordering_enabled}
            initialCategory={
              typeof q.category === "string" ? q.category : "All"
            }
            initialSubcategory={
              typeof q.subcategory === "string" ? q.subcategory : "All"
            }
          />
        </section>
      </>
    );
  }
  if (path[0] === "shop" && path.length >= 2 && path.length <= 3) {
    const mainSlug = decodeURIComponent(path[1]).toLowerCase().trim();
    const cat = store.categories.find(
      (c) =>
        !c.parent_id &&
        c.active !== false &&
        (c.slug.toLowerCase() === mainSlug ||
          c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === mainSlug ||
          c.name.toLowerCase() === mainSlug),
    );
    if (!cat) notFound();

    let subCat: (typeof store.categories)[0] | null = null;
    if (path.length === 3) {
      const subSlug = decodeURIComponent(path[2]).toLowerCase().trim();
      subCat =
        store.categories.find(
          (c) =>
            c.parent_id === cat.id &&
            c.active !== false &&
            (c.slug.toLowerCase() === subSlug ||
              c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === subSlug ||
              c.name.toLowerCase() === subSlug),
        ) || null;
      if (!subCat) notFound();
    }

    return (
      <>
      <BannerSlot banners={store.banners} position="category" categoryIds={[cat.id, ...(subCat ? [subCat.id] : [])]} />
      <CategoryCollectionPage
        category={cat}
        subCategory={subCat}
        categories={store.categories}
        products={store.products}
        settings={store.settings}
      />
      </>
    );
  }
  if (path[0] === "products" && path.length === 2) {
    const p = store.products.find((p) => p.slug === path[1]);
    if (!p) notFound();
    return <ProductDetail p={p} settings={store.settings} />;
  }
  if (path[0] === "category" && path.length === 2) {
    const rawSlug = decodeURIComponent(path[1]).toLowerCase().trim();
    const cat = store.categories.find(
      (c) =>
        !c.parent_id &&
        c.active !== false &&
        (c.slug.toLowerCase() === rawSlug ||
          c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === rawSlug ||
          c.name.toLowerCase() === rawSlug),
    );
    if (!cat) notFound();
    return (
      <>
        <BannerSlot banners={store.banners} position="category" categoryIds={[cat.id]} />
        <CategoryCollectionPage
          category={cat}
          categories={store.categories}
          products={store.products}
          settings={store.settings}
        />
      </>
    );
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
