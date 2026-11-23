"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Profile, money } from "@/lib/core";
import { api } from "../api";
import { ImageUploader } from "./image-uploader";

export type EmployeeDetail = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  photo_url?: string;
  address?: string;
  emergency_contact?: string;
  designation?: string;
  department?: string;
  employment: "full_time" | "part_time";
  pay_basis: "monthly" | "daily" | "hourly";
  rate_paise: number;
  scheduled_units: number;
  daily_minutes: number;
  overtime_rate_paise: number;
  joined_on?: string;
  ended_on?: string | null;
  active: boolean;
  profile_id?: string | null;
  policy_id?: string | null;
  bank_details?: {
    account_number?: string;
    bank_name?: string;
    ifsc_code?: string;
    branch?: string;
  };
  allowances?: { label: string; amount_paise: number }[];
  deductions?: { label: string; amount_paise: number }[];
};

export function EmployeeProfileView({
  employee,
  profile,
  onBack,
  onUpdated,
}: {
  employee: EmployeeDetail;
  profile: Profile;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "personal" | "employment" | "attendance" | "leaves" | "salary"
  >("overview");
  const [emp, setEmp] = useState<EmployeeDetail>(employee);
  const [attendanceMonth, setAttendanceMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [leaveRows, setLeaveRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [showBankDetails, setShowBankDetails] = useState(false);

  // Apply Leave Modal state
  const [showApplyLeave, setShowApplyLeave] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "casual",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    days: 1,
    reason: "",
  });
  const [leaveSaving, setLeaveSaving] = useState(false);

  // Load attendance history for Tab 4 & Overview
  useEffect(() => {
    setLoading(true);
    api<{ rows: any[] }>(
      `/api/erp/attendance?employee_id=${emp.id}&month=${attendanceMonth}`,
    )
      .then((r) => setAttendanceRows(r.rows || []))
      .catch(() => setAttendanceRows([]))
      .finally(() => setLoading(false));
  }, [attendanceMonth, emp.id]);

  // Load leaves for Tab 5 & Overview
  useEffect(() => {
    api<{ rows: any[] }>(`/api/admin/employee_leaves`)
      .then((r) => {
        const empLeaves = (r.rows || []).filter(
          (l: any) => l.employee_id === emp.id,
        );
        setLeaveRows(empLeaves);
      })
      .catch(() => setLeaveRows([]));
  }, [emp.id]);

  // Derived Attendance Stats for Current Month
  const attendanceStats = useMemo(() => {
    let present = 0;
    let half = 0;
    let leaves = 0;
    let absent = 0;
    let overtimeMins = 0;
    for (const r of attendanceRows) {
      if (r.status === "full_day") present++;
      else if (r.status === "half_day") half++;
      else if (r.status === "leave") leaves++;
      else if (r.status === "absent") absent++;
      overtimeMins += Number(r.overtime_minutes || 0);
    }
    const totalWorkingRecorded = present + half + leaves + absent;
    const effectivePresent = present + half * 0.5;
    const percentage = totalWorkingRecorded > 0 ? Math.round((effectivePresent / totalWorkingRecorded) * 100) : 100;
    return { present, half, leaves, absent, overtimeMins, percentage, total: totalWorkingRecorded };
  }, [attendanceRows]);

  // Calculate Tenure / Experience
  const tenureText = useMemo(() => {
    if (!emp.joined_on) return "Recently joined";
    const start = new Date(emp.joined_on);
    const now = new Date();
    const diffMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (diffMonths < 1) return "First month";
    const years = Math.floor(diffMonths / 12);
    const months = diffMonths % 12;
    if (years === 0) return `${months} month${months === 1 ? "" : "s"}`;
    return `${years} yr${years === 1 ? "" : "s"} ${months > 0 ? `${months} mo` : ""}`;
  }, [emp.joined_on]);

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMsg("");

    try {
      await api("/api/erp/employees", {
        id: emp.id,
        data: {
          code: emp.code,
          name: emp.name,
          phone: emp.phone,
          email: emp.email || "",
          photo_url: emp.photo_url || "",
          address: emp.address || "",
          emergency_contact: emp.emergency_contact || "",
          designation: emp.designation || "Sales Executive",
          department: emp.department || "Retail Sales",
          employment: emp.employment,
          pay_basis: emp.pay_basis,
          rate_paise: emp.rate_paise,
          daily_minutes: emp.daily_minutes || 480,
          overtime_rate_paise: emp.overtime_rate_paise || 0,
          active: emp.active,
          joined_on: emp.joined_on || new Date().toISOString().slice(0, 10),
          ended_on: emp.ended_on || null,
          policy_id: emp.policy_id || null,
          allowances: emp.allowances || [],
          deductions: emp.deductions || [],
          bank_details: emp.bank_details || {},
        },
      });

      setSuccessMsg("Employee profile details successfully updated.");
      onUpdated();
    } catch (err) {
      setError((err as Error).message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyLeave(e: React.FormEvent) {
    e.preventDefault();
    setLeaveSaving(true);
    setError("");
    try {
      await api("/api/admin/employee_leaves", {
        data: {
          employee_id: emp.id,
          leave_type: leaveForm.leave_type,
          start_date: leaveForm.start_date,
          end_date: leaveForm.end_date,
          days: Number(leaveForm.days || 1),
          reason: leaveForm.reason.trim(),
          status: "pending",
        },
      });

      // Reload leave rows
      const r = await api<{ rows: any[] }>(`/api/admin/employee_leaves`);
      const empLeaves = (r.rows || []).filter((l: any) => l.employee_id === emp.id);
      setLeaveRows(empLeaves);
      setShowApplyLeave(false);
      setSuccessMsg("Leave application recorded.");
    } catch (err) {
      setError((err as Error).message || "Failed to apply leave.");
    } finally {
      setLeaveSaving(false);
    }
  }

  function exportAttendanceCSV() {
    if (!attendanceRows.length) return;
    const headers = ["Date", "Employee ID", "Name", "Status", "Worked Minutes", "Overtime Minutes", "Notes"];
    const csvLines = [headers.join(",")];
    for (const r of attendanceRows) {
      csvLines.push([
        `"${r.work_on}"`,
        `"${emp.code}"`,
        `"${emp.name}"`,
        `"${r.status}"`,
        `"${r.worked_minutes || 0}"`,
        `"${r.overtime_minutes || 0}"`,
        `"${r.note || ""}"`,
      ].join(","));
    }
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${emp.code}_attendance_${attendanceMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isSuperadmin = profile.role === "superadmin";

  return (
    <div className="luxury-employee-profile">
      {/* Header Bar */}
      <div className="profile-header-strip">
        <button type="button" className="button outline-btn back-btn" onClick={onBack}>
          &larr; Back to Directory
        </button>

        <div className="profile-summary-badge">
          <div className="emp-photo-circle">
            {emp.photo_url ? (
              <img src={emp.photo_url} alt={emp.name} />
            ) : (
              <span className="emp-initials-fallback">
                {emp.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <h2 className="profile-emp-name">{emp.name}</h2>
            <p className="profile-emp-role">
              {emp.designation || "Sales Executive"} &middot; {emp.department || "Retail Sales"} &middot;{" "}
              <code>{emp.code}</code> &middot; <span style={{ fontFamily: "monospace" }}>{emp.phone || "No phone"}</span>
            </p>
          </div>
          <span
            className={`status-pill ${emp.active ? "status-online" : "status-offline"}`}
          >
            {emp.active ? "● Active Staff" : "○ Inactive"}
          </span>
        </div>
      </div>

      {error && <div className="modal-error-banner" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
      {successMsg && (
        <div style={{ background: "#DCFCE7", color: "#166534", padding: "10px 16px", borderRadius: 8, marginBottom: 14, fontWeight: 600, border: "1px solid #86EFAC" }}>
          ✓ {successMsg}
        </div>
      )}

      {/* 6 Profile Tabs Bar */}
      <div className="sp-profile-tabs-bar">
        {[
          { key: "overview", label: "1. Overview" },
          { key: "personal", label: "2. Personal Information" },
          { key: "employment", label: "3. Employment Details" },
          { key: "attendance", label: "4. Attendance History" },
          { key: "leaves", label: "5. Leave History" },
          { key: "salary", label: "6. Salary Details" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`sp-profile-tab-btn ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => {
              setActiveTab(tab.key as any);
              setError("");
              setSuccessMsg("");
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="profile-tab-content">
          {/* Key Metric Highlights */}
          <div className="sp-stats-grid" style={{ marginBottom: 20 }}>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Tenure / Service</span>
                <strong className="sp-stat-count" style={{ fontSize: 24 }}>{tenureText}</strong>
                <span className="sp-stat-sublabel">Joined {emp.joined_on || "—"}</span>
              </div>
              <div className="sp-stat-icon-wrap tone-total">📅</div>
            </div>

            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Month Attendance</span>
                <strong className="sp-stat-count" style={{ color: "#047857" }}>{attendanceStats.percentage}%</strong>
                <span className="sp-stat-sublabel">{attendanceStats.present} full days, {attendanceStats.half} half days</span>
              </div>
              <div className="sp-stat-icon-wrap tone-active">✓</div>
            </div>

            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Salary Package</span>
                <strong className="sp-stat-count" style={{ fontSize: 24, color: "#800020" }}>{money(emp.rate_paise)}</strong>
                <span className="sp-stat-sublabel">per {emp.pay_basis}</span>
              </div>
              <div className="sp-stat-icon-wrap tone-present">₹</div>
            </div>

            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Leaves Taken</span>
                <strong className="sp-stat-count" style={{ color: "#C2410C" }}>{leaveRows.filter((l) => l.status === "approved").length}</strong>
                <span className="sp-stat-sublabel">{leaveRows.length} total applications</span>
              </div>
              <div className="sp-stat-icon-wrap tone-leave">🏖</div>
            </div>
          </div>

          <div className="form-grid-columns">
            {/* Quick Profile Summary */}
            <div className="form-column">
              <h4 className="column-section-title">Identity &amp; Role Summary</h4>
              <div className="info-kv-card">
                <div className="kv-row">
                  <span className="kv-k">Staff Code:</span>
                  <span className="kv-v bold">{emp.code}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Designation:</span>
                  <span className="kv-v">{emp.designation || "Sales Executive"}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Department:</span>
                  <span className="kv-v">{emp.department || "Retail Sales"}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Employment Type:</span>
                  <span className="kv-v">{emp.employment === "part_time" ? "Part Time" : "Full Time"}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Mobile Phone:</span>
                  <span className="kv-v font-mono">{emp.phone || "—"}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Email Address:</span>
                  <span className="kv-v">{emp.email || "—"}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Emergency Contact:</span>
                  <span className="kv-v">{emp.emergency_contact || "—"}</span>
                </div>
              </div>
            </div>

            {/* Quick Actions & Recent Attendance */}
            <div className="form-column">
              <h4 className="column-section-title">Quick Actions &amp; Attendance</h4>
              <div className="sp-advanced-box" style={{ marginBottom: 14 }}>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--erp-text)" }}>
                  Manage attendance, leave applications, or update employee configuration:
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button outline-btn mini-btn"
                    onClick={() => setActiveTab("personal")}
                  >
                    Edit Personal Info →
                  </button>
                  <button
                    type="button"
                    className="button outline-btn mini-btn"
                    onClick={() => setActiveTab("attendance")}
                  >
                    Attendance Register →
                  </button>
                  <button
                    type="button"
                    className="sp-btn-maroon"
                    style={{ height: 32, padding: "0 14px", fontSize: 12 }}
                    onClick={() => setShowApplyLeave(true)}
                  >
                    + Apply Leave
                  </button>
                </div>
              </div>

              {/* Recent 5 Attendance Days */}
              <div className="info-kv-card">
                <span className="column-section-title" style={{ fontSize: 13, margin: "0 0 8px" }}>
                  Recent Attendance Log ({attendanceMonth})
                </span>
                {attendanceRows.slice(0, 5).map((r, i) => (
                  <div className="kv-row" key={i}>
                    <span className="kv-k">{r.work_on}:</span>
                    <span className={`sp-pill-status status-${r.status}`}>
                      {r.status.replace("_", " ")}
                    </span>
                  </div>
                ))}
                {attendanceRows.length === 0 && (
                  <p style={{ fontSize: 12, color: "#888", margin: 4 }}>
                    No attendance recorded yet for this month.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PERSONAL INFORMATION */}
      {activeTab === "personal" && (
        <form onSubmit={handleSaveDetails} className="profile-tab-content">
          <div className="form-grid-columns">
            <div className="form-column">
              <h4 className="column-section-title">Identity &amp; Contact</h4>

              <label className="input-group">
                <span>Full Name *</span>
                <input
                  type="text"
                  required
                  value={emp.name}
                  onChange={(e) => setEmp({ ...emp, name: e.target.value })}
                />
              </label>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Mobile Phone *</span>
                  <input
                    type="tel"
                    required
                    value={emp.phone}
                    onChange={(e) => setEmp({ ...emp, phone: e.target.value })}
                  />
                </label>

                <label className="input-group">
                  <span>Email Address</span>
                  <input
                    type="email"
                    value={emp.email || ""}
                    onChange={(e) => setEmp({ ...emp, email: e.target.value })}
                    placeholder="staff@magaranthamsilks.com"
                  />
                </label>
              </div>

              <label className="input-group">
                <span>Emergency Contact Person &amp; Phone</span>
                <input
                  type="text"
                  value={emp.emergency_contact || ""}
                  onChange={(e) =>
                    setEmp({ ...emp, emergency_contact: e.target.value })
                  }
                  placeholder="e.g. Ramesh (Spouse) - +91 98401 23456"
                />
              </label>

              <label className="input-group">
                <span>Residential Address</span>
                <textarea
                  rows={3}
                  value={emp.address || ""}
                  onChange={(e) => setEmp({ ...emp, address: e.target.value })}
                  placeholder="Door No, Street, City, Pincode"
                />
              </label>
            </div>

            <div className="form-column">
              <h4 className="column-section-title">Profile Photo Upload</h4>
              <ImageUploader
                kind="employee"
                currentImageUrl={emp.photo_url}
                onUploadComplete={(url) => setEmp({ ...emp, photo_url: url })}
                label="Staff Profile Photo (Automatic &le; 50 KB WebP)"
              />
              <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                Upload a clear passport or studio photo of the employee. Automatically compressed and optimized for Magarantham Silks ERP.
              </p>
            </div>
          </div>

          <div className="modal-actions-footer" style={{ marginTop: 20 }}>
            <button type="submit" className="sp-btn-maroon" disabled={saving}>
              {saving ? "Saving Changes..." : "Save Personal Information"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: EMPLOYMENT DETAILS */}
      {activeTab === "employment" && (
        <form onSubmit={handleSaveDetails} className="profile-tab-content">
          <div className="form-grid-columns">
            <div className="form-column">
              <h4 className="column-section-title">Job &amp; Organizational Structure</h4>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Staff Code / ID *</span>
                  <input
                    type="text"
                    required
                    value={emp.code}
                    onChange={(e) => setEmp({ ...emp, code: e.target.value })}
                  />
                </label>

                <label className="input-group">
                  <span>Department</span>
                  <input
                    type="text"
                    value={emp.department || "Retail Sales"}
                    onChange={(e) => setEmp({ ...emp, department: e.target.value })}
                  />
                </label>
              </div>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Designation / Role *</span>
                  <input
                    type="text"
                    value={emp.designation || "Sales Executive"}
                    onChange={(e) => setEmp({ ...emp, designation: e.target.value })}
                  />
                </label>

                <label className="input-group">
                  <span>Employment Type</span>
                  <select
                    value={emp.employment}
                    onChange={(e) => setEmp({ ...emp, employment: e.target.value as any })}
                  >
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                  </select>
                </label>
              </div>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Joining Date</span>
                  <input
                    type="date"
                    value={emp.joined_on || ""}
                    onChange={(e) => setEmp({ ...emp, joined_on: e.target.value })}
                  />
                </label>

                <label className="input-group">
                  <span>Relieving / Ending Date</span>
                  <input
                    type="date"
                    value={emp.ended_on || ""}
                    onChange={(e) => setEmp({ ...emp, ended_on: e.target.value || null })}
                  />
                </label>
              </div>

              <label className="checkbox-item mt-3">
                <input
                  type="checkbox"
                  checked={emp.active}
                  onChange={(e) => setEmp({ ...emp, active: e.target.checked })}
                />
                <span style={{ fontWeight: 600, color: emp.active ? "#166534" : "#64748B" }}>
                  Active Employee (Permitted floor check-in and POS operation)
                </span>
              </label>
            </div>

            <div className="form-column">
              <h4 className="column-section-title">Work Schedule &amp; System Access</h4>

              <label className="input-group">
                <span>Daily Scheduled Shift (Minutes)</span>
                <input
                  type="number"
                  min="60"
                  max="1440"
                  value={emp.daily_minutes || 480}
                  onChange={(e) => setEmp({ ...emp, daily_minutes: Number(e.target.value) || 480 })}
                />
                <small style={{ color: "#888" }}>
                  Standard retail shift: 480 minutes (8 hours)
                </small>
              </label>

              <div className="info-kv-card mt-3">
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--erp-maroon)", display: "block", marginBottom: 6 }}>
                  Linked POS / ERP Login Account
                </span>
                <div className="kv-row">
                  <span className="kv-k">Login State:</span>
                  <span className="kv-v bold">
                    {emp.profile_id ? "Linked Active" : "No Login Assigned"}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
                  Cashiers and floor supervisors can be given POS register login credentials in the Staff Directory.
                </p>
              </div>
            </div>
          </div>

          <div className="modal-actions-footer" style={{ marginTop: 20 }}>
            <button type="submit" className="sp-btn-maroon" disabled={saving}>
              {saving ? "Saving Changes..." : "Save Employment Details"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: ATTENDANCE HISTORY */}
      {activeTab === "attendance" && (
        <div className="profile-tab-content">
          <div className="tab-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h4 className="column-section-title" style={{ margin: 0 }}>Attendance Register Log</h4>
              <p style={{ fontSize: 12, color: "#888", margin: "2px 0 0" }}>
                Daily roll call marks for {emp.name} ({emp.code})
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="month"
                value={attendanceMonth}
                onChange={(e) => setAttendanceMonth(e.target.value)}
                className="sp-filter-select"
              />
              <button type="button" className="sp-btn-gold" onClick={exportAttendanceCSV}>
                📥 Export CSV
              </button>
            </div>
          </div>

          <div className="sp-stats-grid" style={{ marginBottom: 16 }}>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Present</span>
                <strong className="sp-stat-count" style={{ color: "#166534" }}>{attendanceStats.present}</strong>
                <span className="sp-stat-sublabel">Full Days</span>
              </div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Half Days</span>
                <strong className="sp-stat-count" style={{ color: "#CA8A04" }}>{attendanceStats.half}</strong>
                <span className="sp-stat-sublabel">Partial Shift</span>
              </div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Leaves / Absent</span>
                <strong className="sp-stat-count" style={{ color: "#B91C1C" }}>{attendanceStats.leaves + attendanceStats.absent}</strong>
                <span className="sp-stat-sublabel">{attendanceStats.leaves} leave, {attendanceStats.absent} absent</span>
              </div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Overtime</span>
                <strong className="sp-stat-count" style={{ color: "#1D4ED8" }}>{attendanceStats.overtimeMins}m</strong>
                <span className="sp-stat-sublabel">{Math.round((attendanceStats.overtimeMins / 60) * 10) / 10} hours</span>
              </div>
            </div>
          </div>

          <table className="luxury-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Worked Time</th>
                <th>Overtime</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.length > 0 ? (
                attendanceRows.map((row, i) => (
                  <tr key={i}>
                    <td className="date-cell" style={{ fontWeight: 600 }}>{row.work_on}</td>
                    <td>
                      <span className={`sp-pill-status status-${row.status}`}>
                        {row.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>{Math.floor((row.worked_minutes || 0) / 60)} hrs {(row.worked_minutes || 0) % 60} mins</td>
                    <td>{row.overtime_minutes ? `${row.overtime_minutes} mins` : "—"}</td>
                    <td>{row.note || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="table-empty-cell">
                    {loading ? "Loading attendance log..." : `No attendance recorded for ${attendanceMonth}.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 5: LEAVE HISTORY */}
      {activeTab === "leaves" && (
        <div className="profile-tab-content">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h4 className="column-section-title" style={{ margin: 0 }}>Leave Applications &amp; Balances</h4>
              <p style={{ fontSize: 12, color: "#888", margin: "2px 0 0" }}>
                Leave history and recorded balances for this employee
              </p>
            </div>
            <button
              type="button"
              className="sp-btn-maroon"
              onClick={() => setShowApplyLeave(true)}
            >
              + Apply Leave
            </button>
          </div>

          <div className="leave-summary-grid" style={{ marginBottom: 20 }}>
            <div className="leave-balance-card">
              <span className="balance-val">12</span>
              <span className="balance-lbl">Casual Leave Quota</span>
            </div>
            <div className="leave-balance-card">
              <span className="balance-val">6</span>
              <span className="balance-lbl">Sick Leave Quota</span>
            </div>
            <div className="leave-balance-card">
              <span className="balance-val">{leaveRows.length}</span>
              <span className="balance-lbl">Total Applications</span>
            </div>
          </div>

          <table className="luxury-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Duration</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {leaveRows.length > 0 ? (
                leaveRows.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <span className="tag-luxury" style={{ textTransform: "uppercase" }}>
                        {l.leave_type}
                      </span>
                    </td>
                    <td className="date-cell">{l.start_date}</td>
                    <td className="date-cell">{l.end_date}</td>
                    <td>{l.days} day{Number(l.days) === 1 ? "" : "s"}</td>
                    <td>{l.reason || "—"}</td>
                    <td>
                      <span className={`sp-pill-status ${l.status === "approved" ? "status-full_day" : l.status === "rejected" ? "status-absent" : "status-half_day"}`}>
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="table-empty-cell">
                    {loading ? "Loading leaves..." : "No leave applications recorded for this employee."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 6: SALARY DETAILS */}
      {activeTab === "salary" && (
        <form onSubmit={handleSaveDetails} className="profile-tab-content">
          <div className="form-grid-columns">
            <div className="form-column">
              <h4 className="column-section-title">Compensation Structure</h4>
              <div className="info-kv-card">
                <div className="kv-row">
                  <span className="kv-k">Pay Basis:</span>
                  <span className="kv-v bold">{emp.pay_basis.toUpperCase()}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Base Pay Rate:</span>
                  <span className="kv-v bold" style={{ color: "#800020", fontSize: 16 }}>
                    {money(emp.rate_paise)}
                  </span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Scheduled Units:</span>
                  <span className="kv-v">{emp.scheduled_units || 26} days / month</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Standard Daily Shift:</span>
                  <span className="kv-v">{Math.floor((emp.daily_minutes || 480) / 60)} hours / day</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Overtime Hourly Rate:</span>
                  <span className="kv-v bold">{money(emp.overtime_rate_paise || 0)} / hr</span>
                </div>
              </div>

              <h4 className="column-section-title mt-4">Recurring Allowances &amp; Deductions</h4>
              <div className="allowances-deductions-box">
                <div>
                  <strong>Monthly Allowances:</strong>
                  {emp.allowances?.length ? (
                    emp.allowances.map((a, i) => (
                      <p key={i}>&bull; {a.label}: {money(a.amount_paise)}</p>
                    ))
                  ) : (
                    <p className="empty-sub">None configured.</p>
                  )}
                </div>
                <div>
                  <strong>Monthly Deductions:</strong>
                  {emp.deductions?.length ? (
                    emp.deductions.map((d, i) => (
                      <p key={i}>&bull; {d.label}: {money(d.amount_paise)}</p>
                    ))
                  ) : (
                    <p className="empty-sub">None configured.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Confidential Bank Details */}
            <div className="form-column">
              <h4 className="column-section-title">Bank Account Details</h4>
              <div className="bank-security-panel">
                <div className="security-notice">
                  <span>🔒 Protected by Role-Based Access Control</span>
                </div>

                {isSuperadmin ? (
                  showBankDetails ? (
                    <div className="bank-fields-view">
                      <div className="row-inputs-2">
                        <label className="input-group">
                          <span>Bank Name</span>
                          <input
                            type="text"
                            value={emp.bank_details?.bank_name || ""}
                            onChange={(e) =>
                              setEmp({
                                ...emp,
                                bank_details: { ...emp.bank_details, bank_name: e.target.value },
                              })
                            }
                          />
                        </label>
                        <label className="input-group">
                          <span>Account Number</span>
                          <input
                            type="text"
                            value={emp.bank_details?.account_number || ""}
                            onChange={(e) =>
                              setEmp({
                                ...emp,
                                bank_details: { ...emp.bank_details, account_number: e.target.value },
                              })
                            }
                          />
                        </label>
                      </div>

                      <div className="row-inputs-2">
                        <label className="input-group">
                          <span>IFSC Code</span>
                          <input
                            type="text"
                            value={emp.bank_details?.ifsc_code || ""}
                            onChange={(e) =>
                              setEmp({
                                ...emp,
                                bank_details: { ...emp.bank_details, ifsc_code: e.target.value.toUpperCase() },
                              })
                            }
                          />
                        </label>
                        <label className="input-group">
                          <span>Branch Location</span>
                          <input
                            type="text"
                            value={emp.bank_details?.branch || ""}
                            onChange={(e) =>
                              setEmp({
                                ...emp,
                                bank_details: { ...emp.bank_details, branch: e.target.value },
                              })
                            }
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        className="button mini-btn mt-2"
                        onClick={() => setShowBankDetails(false)}
                      >
                        Hide Confidential Details
                      </button>
                    </div>
                  ) : (
                    <div className="bank-masked-box">
                      <p>Bank details are securely encrypted and masked.</p>
                      <button
                        type="button"
                        className="button outline-btn"
                        onClick={() => setShowBankDetails(true)}
                      >
                        👁 Reveal &amp; Edit Bank Information
                      </button>
                    </div>
                  )
                ) : (
                  <div className="access-denied-box">
                    <p>You do not have permission to view sensitive employee banking credentials.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="modal-actions-footer" style={{ marginTop: 20 }}>
            <button type="submit" className="sp-btn-maroon" disabled={saving}>
              {saving ? "Saving Changes..." : "Save Salary & Bank Details"}
            </button>
          </div>
        </form>
      )}

      {/* Apply Leave Modal */}
      {showApplyLeave && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !leaveSaving && setShowApplyLeave(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">Apply Leave for {emp.name}</h2>
              <button
                type="button"
                className="modal-close-btn"
                disabled={leaveSaving}
                onClick={() => setShowApplyLeave(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleApplyLeave} className="modal-form-body">
              <label className="input-group">
                <span>Leave Type *</span>
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                >
                  <option value="casual">Casual Leave</option>
                  <option value="sick">Sick Leave</option>
                  <option value="earned">Earned Leave</option>
                  <option value="emergency">Emergency Leave</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </label>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Start Date *</span>
                  <input
                    type="date"
                    required
                    value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                  />
                </label>
                <label className="input-group">
                  <span>End Date *</span>
                  <input
                    type="date"
                    required
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                  />
                </label>
              </div>

              <label className="input-group">
                <span>Days Count *</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  value={leaveForm.days}
                  onChange={(e) => setLeaveForm({ ...leaveForm, days: Number(e.target.value) || 1 })}
                />
              </label>

              <label className="input-group">
                <span>Reason / Notes</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Family festival, medical appointment..."
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                />
              </label>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={leaveSaving}
                  onClick={() => setShowApplyLeave(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="sp-btn-maroon" disabled={leaveSaving}>
                  {leaveSaving ? "Submitting..." : "Submit Leave Application"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
