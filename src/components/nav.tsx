"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Settings, Profile } from "@/lib/core";
import { api } from "./api";
import { useShop } from "./shop-context";
import { CustomerAuthModal } from "./customer-auth-modal";

function UserRoundIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

export function Nav({
  settings,
  categories,
  initialProfile = null,
}: {
  settings: Settings;
  categories: string[];
  initialProfile?: Profile | null;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    path = usePathname();
  const { cart } = useShop();

  useEffect(() => {
    setOpen(false);
    dialog.current?.close();
  }, [path]);

  useEffect(() => {
    if (path?.startsWith("/admin")) return;
    let active = true;
    api<{ profile?: Profile }>("/api/account/session")
      .then((res) => {
        if (active) setProfile(res?.profile ?? null);
      })
      .catch(() => {
        if (active) setProfile(null);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (path?.startsWith("/admin")) return null;

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
          <Link href="/">Home</Link>
          <Link href="/shop">All sarees</Link>
          <Link
            href="/cart"
            aria-label={`Shopping bag, ${cart.reduce((s, x) => s + x.quantity, 0)} items`}
          >
            Bag ({cart.reduce((s, x) => s + x.quantity, 0)})
          </Link>
          <Link
            href="/account"
            onClick={(e) => {
              if (!profile) {
                e.preventDefault();
                setShowAuthModal(true);
              }
            }}
            className={`header-account-link ${profile ? "is-logged-in" : ""}`}
            aria-label={
              profile
                ? `My Account, signed in as ${profile.display_name || "customer"}`
                : "Login / My Account"
            }
          >
            <UserRoundIcon className="account-icon-svg" />
            {profile && <span className="account-status-dot" aria-hidden="true" />}
            <span className="account-tooltip" role="tooltip">
              {profile
                ? `My Account · ${profile.display_name || "Signed in"}`
                : "Login / My Account"}
            </span>
          </Link>
        </nav>
      </header>
      <CustomerAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialRedirect="/account"
      />
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
              {!profile ? (
                <button
                  type="button"
                  onClick={() => {
                    dialog.current?.close();
                    setOpen(false);
                    setShowAuthModal(true);
                  }}
                  className="text-link"
                  style={{ textAlign: "left", padding: 0, font: "inherit", color: "inherit", background: "none", border: "none", cursor: "pointer" }}
                >
                  Sign in
                </button>
              ) : (
                <Link href="/account">Account settings</Link>
              )}
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
