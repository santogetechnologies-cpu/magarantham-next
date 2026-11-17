"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Settings } from "@/lib/core";
import { useShop } from "./shop-context";
export function Nav({
  settings,
  categories,
}: {
  settings: Settings;
  categories: string[];
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    path = usePathname();
  const { cart } = useShop();
  useEffect(() => {
    setOpen(false);
    dialog.current?.close();
  }, [path]);
  function toggle() {
    if (open) dialog.current?.close();
    else dialog.current?.showModal();
    setOpen(!open);
  }
  return (
    <>
      <div className="announcement">{settings.announcement}</div>
      <header className="site-header">
        <button
          onClick={toggle}
          aria-label="Open full menu"
          className="menu-button"
        >
          <span />
          <span />
          Menu
        </button>
        <Link href="/" className="brand">
          <img src={settings.logo_image} alt="மகரந்தம் சில்க்ஸ் logo" />
          <span>
            {settings.brand_name}
            <small>SILKS · SAREES · CELEBRATIONS</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/shop">All sarees</Link>
          <Link href="/account">Account</Link>
          <Link
            href="/cart"
            aria-label={`Shopping bag, ${cart.reduce((s, x) => s + x.quantity, 0)} items`}
          >
            Bag ({cart.reduce((s, x) => s + x.quantity, 0)})
          </Link>
        </nav>
      </header>
      <dialog
        ref={dialog}
        onCancel={() => setOpen(false)}
        className="mega"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) {
            dialog.current?.close();
            setOpen(false);
          }
        }}
      >
        <div className="mega-top">
          <span className="eyebrow">மகரந்தம் சில்க்ஸ்</span>
          <button onClick={toggle} aria-label="Close menu">
            Close ×
          </button>
        </div>
        <div className="mega-body">
          <div>
            <p className="eyebrow">Find your saree</p>
            <Link className="menu-title" href="/shop">
              All collections ↗
            </Link>
            <Link className="menu-title" href="/shop?category=Bridal">
              Wedding sarees
            </Link>
            <Link className="menu-title" href="/shop?category=Cotton">
              Everyday sarees
            </Link>
            <Link className="menu-title" href="/bulk">
              Bulk purchase
            </Link>
            <div className="menu-links">
              <Link href="/account">My account</Link>
              <Link href="/cart">Shopping bag</Link>
              <Link href="/login">Sign in</Link>
            </div>
          </div>
          <div className="menu-categories">
            {categories.map((c) => (
              <Link key={c} href={`/shop?category=${encodeURIComponent(c)}`}>
                {c}
                <span>↗</span>
              </Link>
            ))}
          </div>
          <Link href="/shop?category=Bridal" className="menu-photo">
            <img src="/assets/product-04.jpg" alt="Rose gold bridal saree" />
            <span>
              Your special day.
              <br />
              <b>Your perfect saree.</b>
            </span>
          </Link>
        </div>
        <p className="mega-bottom">
          Silk. Cotton. Bridal. Every style, in one place.
        </p>
      </dialog>
    </>
  );
}
