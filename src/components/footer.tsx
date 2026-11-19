"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "@/lib/core";

export function Footer({ settings }: { settings: Settings }) {
  const path = usePathname();
  if (path?.startsWith("/admin")) return null;

  return (
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
  );
}
