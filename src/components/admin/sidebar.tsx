"use client";
import React, { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Profile } from "@/lib/core";
import { api } from "../api";

const SCROLL_STORAGE_KEY = "ms_admin_sidebar_scroll";
const COLLAPSED_STORAGE_KEY = "ms_admin_sidebar_collapsed";
let cachedSidebarScrollTop = 0;
let cachedCollapsedGroups: Record<string, boolean> | null = null;

export type NavItem = {
  key: string;
  label: string;
  href: string;
  cap?: string;
  badge?: string;
  icon: string;
  matchQuery?: { param: string; value: string };
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const adminNavGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { key: "", label: "Dashboard", href: "/admin", icon: "grid" },
      { key: "pos", label: "POS Billing", href: "/admin/pos", cap: "pos", icon: "pos" },
      { key: "orders", label: "Online Orders", href: "/admin/orders", cap: "orders", icon: "bag" },
    ],
  },
  {
    title: "Catalogue & Stock",
    items: [
      { key: "products", label: "All Sarees", href: "/admin/products", cap: "catalogue", icon: "layers" },
      {
        key: "products",
        label: "Add New Saree",
        href: "/admin/products?action=new",
        cap: "catalogue",
        icon: "plus",
        matchQuery: { param: "action", value: "new" },
      },
      { key: "categories", label: "Categories", href: "/admin/categories", cap: "superadmin", icon: "tag" },
      { key: "inventory", label: "Stock Ledger", href: "/admin/inventory", cap: "inventory", icon: "box" },
      {
        key: "inventory",
        label: "Low Stock Alerts",
        href: "/admin/inventory?tab=low",
        cap: "inventory",
        badge: "Alerts",
        icon: "alert",
        matchQuery: { param: "tab", value: "low" },
      },
      { key: "labels", label: "Barcode Labels", href: "/admin/labels", cap: "inventory", icon: "barcode" },
      { key: "purchases", label: "Purchases", href: "/admin/purchases", cap: "purchases", icon: "truck" },
      { key: "suppliers", label: "Suppliers", href: "/admin/suppliers", cap: "purchases", icon: "building" },
    ],
  },
  {
    title: "Offers & Marketing",
    items: [
      { key: "offers", label: "Festival Offers", href: "/admin/offers", cap: "offers", icon: "sparkle" },
      { key: "bulk", label: "Bulk Inquiries", href: "/admin/bulk", cap: "bulk", icon: "mail" },
    ],
  },
  {
    title: "Staff & Payroll",
    items: [
      { key: "employees", label: "Employees", href: "/admin/employees", cap: "superadmin", icon: "users" },
      { key: "staff-logins", label: "Staff Logins", href: "/admin/staff-logins", cap: "superadmin", icon: "activity" },
      { key: "attendance", label: "Daily Attendance", href: "/admin/attendance", cap: "attendance", icon: "clock" },
      { key: "payroll", label: "Monthly Payroll", href: "/admin/payroll", cap: "superadmin", icon: "wallet" },
      { key: "salary-policies", label: "Salary Rules", href: "/admin/salary-policies", cap: "superadmin", icon: "file" },
    ],
  },
  {
    title: "Finance & Reports",
    items: [
      { key: "reports", label: "ERP Reports", href: "/admin/reports", cap: "reports", icon: "chart" },
      { key: "expenses", label: "Expenses", href: "/admin/expenses", cap: "expenses", icon: "receipt" },
      { key: "expense-categories", label: "Expense Heads", href: "/admin/expense-categories", cap: "superadmin", icon: "folder" },
    ],
  },
  {
    title: "Administration",
    items: [
      { key: "staff", label: "Staff Access", href: "/admin/staff", cap: "superadmin", icon: "shield" },
      { key: "settings", label: "Store Settings", href: "/admin/settings", cap: "superadmin", icon: "settings" },
      { key: "pos-settings", label: "POS Settings", href: "/admin/pos-settings", cap: "superadmin", icon: "sliders" },
      { key: "shipping", label: "Shipping & Tracking", href: "/admin/shipping", cap: "shipping", icon: "map" },
      { key: "audit", label: "Activity Logs", href: "/admin/audit", cap: "superadmin", icon: "activity" },
    ],
  },
];

function NavIcon({ name }: { name: string }) {
  const props = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "nav-item-icon",
    "aria-hidden": true,
  };

  switch (name) {
    case "grid":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "pos":
      return (
        <svg {...props}>
          <rect x="2" y="4" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 18v3" />
        </svg>
      );
    case "bag":
      return (
        <svg {...props}>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "layers":
      return (
        <svg {...props}>
          <path d="m12 2 10 5-10 5L2 7Z" />
          <path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "tag":
      return (
        <svg {...props}>
          <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42Z" />
          <circle cx="7" cy="7" r="1" />
        </svg>
      );
    case "box":
      return (
        <svg {...props}>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
        </svg>
      );
    case "alert":
      return (
        <svg {...props}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "barcode":
      return (
        <svg {...props}>
          <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
        </svg>
      );
    case "truck":
      return (
        <svg {...props}>
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
          <path d="M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
          <circle cx="17" cy="18" r="2" />
          <circle cx="7" cy="18" r="2" />
        </svg>
      );
    case "building":
      return (
        <svg {...props}>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...props}>
          <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z" />
        </svg>
      );
    case "ticket":
      return (
        <svg {...props}>
          <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
          <path d="M13 5v2M13 17v2M13 11v2" />
        </svg>
      );
    case "percent":
      return (
        <svg {...props}>
          <line x1="19" y1="5" x2="5" y2="19" />
          <circle cx="6.5" cy="6.5" r="2.5" />
          <circle cx="17.5" cy="17.5" r="2.5" />
        </svg>
      );
    case "image":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      );
    case "mail":
      return (
        <svg {...props}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "clock":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...props}>
          <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
        </svg>
      );
    case "file":
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M16 13H8M16 17H8" />
        </svg>
      );
    case "chart":
      return (
        <svg {...props}>
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...props}>
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
          <path d="M8 7h8M8 11h8M8 15h5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...props}>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      );
    case "sliders":
      return (
        <svg {...props}>
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" />
        </svg>
      );
    case "map":
      return (
        <svg {...props}>
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      );
  }
}

export function AdminSidebar({
  currentSection,
  profile,
  isOpen = false,
  onClose,
}: {
  currentSection: string;
  profile: Profile;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    if (cachedCollapsedGroups) return cachedCollapsedGroups;
    if (typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage.getItem(COLLAPSED_STORAGE_KEY);
        if (raw) {
          cachedCollapsedGroups = JSON.parse(raw);
          return cachedCollapsedGroups!;
        }
      } catch { }
    }
    return {};
  });
  const navRef = useRef<HTMLElement>(null);
  const searchParams = useSearchParams();

  function saveScroll() {
    if (!navRef.current) return;
    cachedSidebarScrollTop = navRef.current.scrollTop;
    try {
      window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(cachedSidebarScrollTop));
    } catch { }
  }

  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    let target = cachedSidebarScrollTop;
    if (!target) {
      try {
        const raw = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
        if (raw) target = Number(raw) || 0;
      } catch { }
    }
    if (target > 0) {
      el.scrollTop = target;
    }
  }, [currentSection]);

  function toggleGroup(title: string) {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      cachedCollapsedGroups = next;
      try {
        window.sessionStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch { }
      return next;
    });
  }

  const permitted = (cap?: string) => {
    if (!cap) return true;
    if (profile.role === "superadmin") return true;
    if (profile.role === "billing") return cap === "pos" || cap === "expenses";
    if (cap === "superadmin") return false;
    return profile.permissions?.includes(cap as any);
  };

  function isItemActive(item: NavItem) {
    const sectionMatches =
      currentSection === item.key ||
      (item.key === "" && currentSection === "dashboard");

    if (!sectionMatches) return false;

    if (item.matchQuery) {
      return searchParams.get(item.matchQuery.param) === item.matchQuery.value;
    }

    // Don't highlight the base section item if a query-specific sibling is active
    if (item.key === "products" && searchParams.get("action") === "new") {
      return false;
    }
    if (item.key === "inventory" && searchParams.get("tab") === "low") {
      return false;
    }

    return true;
  }

  async function handleSignOut() {
    try {
      await api("/api/auth/logout", {});
    } catch { }
    window.location.assign("/login");
  }

  const roleDisplay =
    profile.role === "superadmin"
      ? "Super Administrator"
      : profile.role === "manager"
        ? "Store Manager"
        : profile.role === "billing"
          ? "POS Billing Staff"
          : "Staff Member";

  const initials =
    (profile.display_name || profile.email || "M")
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "MS";

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="admin-mobile-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside className={`luxury-admin-sidebar ${isOpen ? "open" : ""}`}>
        {/* Brand Header */}
        <div className="sidebar-brand-block">
          <Link href="/admin" className="sidebar-brand-link" onClick={onClose}>
            <div className="brand-crest-wrapper">
              <span className="brand-crest-symbol">✦</span>
              <span className="brand-tamil-title" lang="ta">மகரந்தம் சில்க்ஸ்</span>
            </div>
            <span className="brand-title-en">MAGARANTHAM SILKS</span>
            <span className="brand-subtitle-gold">ENTERPRISE ERP &amp; RETAIL SUITE</span>
          </Link>
          {onClose && (
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={onClose}
              aria-label="Close navigation"
            >
              ✕
            </button>
          )}
        </div>

        {/* User Card */}
        <div className="sidebar-user-card">
          <div className="user-avatar-initials">{initials}</div>
          <div className="user-details">
            <span className="user-name">
              {profile.display_name || profile.email.split("@")[0]}
            </span>
            <span className="user-role-badge">{roleDisplay}</span>
          </div>
        </div>

        {/* Navigation Groups */}
        <nav
          ref={navRef}
          onScroll={saveScroll}
          className="sidebar-grouped-nav"
          aria-label="ERP Admin Navigation"
        >
          {adminNavGroups.map((group) => {
            const visibleItems = group.items.filter((item) => permitted(item.cap));
            if (!visibleItems.length) return null;
            const isCollapsed = collapsedGroups[group.title];

            return (
              <div key={group.title} className="sidebar-nav-group">
                <button
                  type="button"
                  className="nav-group-header"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!isCollapsed}
                >
                  <span>{group.title}</span>
                  <span className={`group-chevron ${isCollapsed ? "collapsed" : ""}`}>
                    ▾
                  </span>
                </button>

                {!isCollapsed && (
                  <ul className="nav-group-items">
                    {visibleItems.map((item) => {
                      const isActive = isItemActive(item);

                      return (
                        <li key={item.href + item.label}>
                          <Link
                            href={item.href}
                            className={`nav-item-link ${isActive ? "active" : ""}`}
                            onClick={() => {
                              saveScroll();
                              onClose?.();
                            }}
                          >
                            <NavIcon name={item.icon} />
                            <span className="nav-item-label">{item.label}</span>
                            {item.badge && (
                              <span className="nav-item-badge">{item.badge}</span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer Actions */}
        <div className="sidebar-footer">
          <Link href="/" target="_blank" className="footer-action-link">
            <span>Online Store</span>
            <span aria-hidden="true">↗</span>
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="footer-signout-btn"
          >
            <span>Sign Out</span>
            <span aria-hidden="true">⎋</span>
          </button>
        </div>
      </aside>
    </>
  );
}
