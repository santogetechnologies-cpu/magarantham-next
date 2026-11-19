import type { Metadata } from "next";
import { ReactNode } from "react";
import Link from "next/link";
import { getStore } from "@/lib/store";
import { identity } from "@/lib/server";
import { Profile } from "@/lib/core";
import {StoreSync} from "@/components/store-sync";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { ShopProvider } from "@/components/shop-context";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "மகரந்தம் சில்க்ஸ் | Sarees for every occasion",
    template: "%s | மகரந்தம் சில்க்ஸ்",
  },
  description:
    "Shop silk, bridal, cotton, soft silk, Banarasi, organza and more at மகரந்தம் சில்க்ஸ்.",
};
export const dynamic = "force-dynamic";
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { settings, products, categories: dbCategories } = await getStore();
  const mainCategoryNames = [
    ...new Set([
      ...dbCategories.filter((c) => !c.parent_id).map((c) => c.name),
      ...products.map((p) => p.category),
    ]),
  ];
  let initialProfile: Profile | null = null;
  try {
    const session = await identity();
    initialProfile = session.profile;
  } catch {
    initialProfile = null;
  }
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ShopProvider><StoreSync/>
          <Nav
            settings={settings}
            categories={mainCategoryNames}
            initialProfile={initialProfile}
          />
          <main id="main">{children}</main>
          <Footer settings={settings} />
        </ShopProvider>
      </body>
    </html>
  );
}
