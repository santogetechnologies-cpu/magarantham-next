"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Profile } from "@/lib/core";
import { useRouter } from "next/navigation";

export function AdminTopbar({
  section,
  profile,
  onOpenSidebar,
}: {
  section: string;
  profile: Profile;
  onOpenSidebar: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/admin/products?search=${encodeURIComponent(searchQuery.trim())}`);
  }

  const sectionTitles: Record<string, string> = {
    "": "Dashboard Overview",
    dashboard: "Dashboard Overview",
    products: "Saree Catalogue",
    "product-new": "Add New Saree",
    inventory: "Stock Management",
    "stock-movements": "Stock Movement Ledger",
    "low-stock": "Low Stock Alerts",
    categories: "Categories & Weaves",
    labels: "Barcode & MSU Label Printing",
    pos: "POS Billing Register",
    purchases: "Purchases & Inward Goods",
    suppliers: "Weavers & Mill Suppliers",
    orders: "Online Saree Orders",
    employees: "Staff & Weavers Directory",
    "staff-logins": "Today's Staff Logins",
    "employee-new": "Register New Staff",
    attendance: "Daily Attendance Register",
    leaves: "Leave Management",
    "attendance-reports": "Staff Attendance Reports",
    payroll: "Monthly Payroll Processing",
    "salary-policies": "Salary & Shift Policies",
    "store-profile": "Store Profile & Branding",
    "admin-accounts": "Staff User Accounts",
    "staff-permissions": "Role & Permission Matrix",
    settings: "Store & Invoice Settings",
    audit: "Operational Activity Logs",
    offers: "Festival & Seasonal Offers",
    "offer-new": "Create Promotional Offer",
    coupons: "Coupon Codes & Vouchers",
    pricing: "Product Pricing Matrix",
    "price-history": "Price Change Audit Trail",
    discounts: "Cross-Channel Discounts",
    "sales-reports": "Sales Analytics & Reports",
    "stock-reports": "Inventory Valuation Reports",
    "employee-reports": "HR & Attendance Reports",
    reports: "Executive ERP Reports",
    notifications: "Store Alerts & Notifications",
    expenses: "Shop Operating Expenses",
    "expense-categories": "Expense Accounting Heads",
    "pos-settings": "POS Terminal Configuration",
    banners: "Storefront Banners & Campaigns",
    shipping: "Logistics & Courier Tracking",
    bulk: "Bulk Saree Inquiries",
    staff: "Staff Access Control",
  };

  const title = sectionTitles[section] || section || "Dashboard";
  const canManageCatalogue =
    profile.role === "superadmin" ||
    (profile.role === "manager" && profile.permissions.includes("catalogue"));

  return (
    <header className="luxury-admin-topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-menu-toggle"
          onClick={onOpenSidebar}
          aria-label="Toggle navigation menu"
        >
          <span />
          <span />
          <span />
        </button>

        <div className="topbar-breadcrumbs">
          <span className="crumb-brand">MAGARANTHAM SILKS</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-section">{title}</span>
        </div>
      </div>

      {canManageCatalogue && (
        <div className="topbar-center">
          <form onSubmit={handleSearch} className="topbar-search-form">
            <span className="search-icon">🔍</span>
            <input
              type="search"
              placeholder="Search sarees, SKU, barcode, employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="topbar-search-input"
            />
          </form>
        </div>
      )}

      <div className="topbar-right">
        {/* Quick Action Button (hidden for billing users) */}
        {canManageCatalogue && (
          <Link
            href="/admin/products?action=new"
            className="topbar-quick-add-btn"
          >
            <span>+ Add Saree</span>
          </Link>
        )}
      </div>
    </header>
  );
}
