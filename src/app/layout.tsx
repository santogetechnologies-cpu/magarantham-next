import type { Metadata } from "next";
import { ReactNode } from "react";
import Link from "next/link";
import { getStore } from "@/lib/store";
import {StoreSync} from "@/components/store-sync";
import { Nav } from "@/components/nav";
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
  const { settings, products } = await getStore();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ShopProvider><StoreSync/>
          <Nav
            settings={settings}
            categories={[...new Set(products.map((p) => p.category))]}
          />
          <main id="main">{children}</main>
          <footer className="footer">
            <div>
              <img src={settings.logo_image} alt="மகரந்தம் சில்க்ஸ்" />
              <h2 lang="ta">{settings.brand_name}</h2>
              <p>{settings.tagline}</p>
            </div>
            <div>
              <p className="eyebrow">Find your saree</p>
              <Link href="/shop">All sarees</Link>
              <Link href="/shop?category=Bridal">Bridal sarees</Link>
              <Link href="/shop?category=Cotton">Cotton sarees</Link>
              <Link href="/bulk">Bulk purchase</Link>
            </div>
            <div>
              <p className="eyebrow">We’re here to help</p>
              <Link href="/account">My orders</Link>
              <Link href="/account">My account</Link>
              {settings.support_phone && (
                <a href={`tel:${settings.support_phone}`}>
                  {settings.support_phone}
                </a>
              )}
              {settings.support_email && (
                <a href={`mailto:${settings.support_email}`}>
                  {settings.support_email}
                </a>
              )}
              <Link href="/admin">Staff sign in</Link>
            </div>
            <div className="footer-bottom">
              © {new Date().getFullYear()} {settings.brand_name}.
              <span>Silk. Cotton. A saree for every moment.</span>
            </div>
          </footer>
        </ShopProvider>
      </body>
    </html>
  );
}
