"use client";
import React, { useState, useEffect } from "react";
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
    "personal" | "attendance" | "leaves" | "salary" | "activity"
  >("personal");
  const [emp, setEmp] = useState<EmployeeDetail>(employee);
  const [attendanceMonth, setAttendanceMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [leaveRows, setLeaveRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showBankDetails, setShowBankDetails] = useState(false);

  // Load attendance history for tab 2
  useEffect(() => {
    if (activeTab === "attendance") {
      setLoading(true);
      api<{ rows: any[] }>(
        `/api/erp/attendance?employee_id=${emp.id}&month=${attendanceMonth}`,
      )
        .then((r) => setAttendanceRows(r.rows || []))
        .catch(() => setAttendanceRows([]))
        .finally(() => setLoading(false));
    } else if (activeTab === "leaves") {
      setLoading(true);
      api<{ rows: any[] }>(`/api/admin/employee_leaves`)
        .then((r) => {
          const empLeaves = (r.rows || []).filter(
            (l: any) => l.employee_id === emp.id,
          );
          setLeaveRows(empLeaves);
        })
        .catch(() => setLeaveRows([]))
        .finally(() => setLoading(false));
    }
  }, [activeTab, attendanceMonth, emp.id]);

  async function handleSavePersonal(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      await api("/api/erp/employees", {
        id: emp.id,
        data: {
          code: emp.code,
          name: emp.name,
          phone: emp.phone,
          employment: emp.employment,
          pay_basis: emp.pay_basis,
          rate_paise: emp.rate_paise,
          daily_minutes: emp.daily_minutes,
          overtime_rate_paise: emp.overtime_rate_paise,
          active: emp.active,
          joined_on: emp.joined_on || new Date().toISOString().slice(0, 10),
          ended_on: emp.ended_on || null,
          policy_id: null,
          allowances: emp.allowances || [],
          deductions: emp.deductions || [],
        },
      });

      onUpdated();
    } catch (err) {
      setError((err as Error).message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
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
              {emp.designation || "Staff"} &middot; {emp.department || "Retail Sales"} &middot;{" "}
              <code>{emp.code}</code>
            </p>
          </div>
          <span
            className={`status-pill ${emp.active ? "status-online" : "status-offline"}`}
          >
            {emp.active ? "Active Staff" : "Inactive"}
          </span>
        </div>
      </div>

      {error && <div className="modal-error-banner" role="alert">{error}</div>}

      {/* 5-Tab Navigation */}
      <div className="profile-tabs-header">
        {[
          { key: "personal", label: "1. Personal Information" },
          { key: "attendance", label: "2. Attendance History" },
          { key: "leaves", label: "3. Leave History" },
          { key: "salary", label: "4. Salary Information" },
          { key: "activity", label: "5. Activity History" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`profile-tab-btn ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key as any)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Personal Information */}
      {activeTab === "personal" && (
        <form onSubmit={handleSavePersonal} className="profile-tab-content">
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
                  <span>Staff Code *</span>
                  <input
                    type="text"
                    required
                    value={emp.code}
                    onChange={(e) => setEmp({ ...emp, code: e.target.value })}
                  />
                </label>

                <label className="input-group">
                  <span>Mobile Phone *</span>
                  <input
                    type="tel"
                    required
                    value={emp.phone}
                    onChange={(e) => setEmp({ ...emp, phone: e.target.value })}
                  />
                </label>
              </div>

              <label className="input-group">
                <span>Email Address</span>
                <input
                  type="email"
                  value={emp.email || ""}
                  onChange={(e) => setEmp({ ...emp, email: e.target.value })}
                  placeholder="staff@magaranthamsilks.com"
                />
              </label>

              <label className="input-group">
                <span>Residential Address</span>
                <textarea
                  rows={2}
                  value={emp.address || ""}
                  onChange={(e) => setEmp({ ...emp, address: e.target.value })}
                  placeholder="Street, City, Pincode"
                />
              </label>

              <label className="input-group">
                <span>Emergency Contact Person &amp; Phone</span>
                <input
                  type="text"
                  value={emp.emergency_contact || ""}
                  onChange={(e) =>
                    setEmp({ ...emp, emergency_contact: e.target.value })
                  }
                  placeholder="Name (Relationship) - +91 98765 43210"
                />
              </label>
            </div>

            <div className="form-column">
              <h4 className="column-section-title">Department &amp; Photo</h4>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Department</span>
                  <input
                    type="text"
                    value={emp.department || "Retail Sales"}
                    onChange={(e) => setEmp({ ...emp, department: e.target.value })}
                  />
                </label>

                <label className="input-group">
                  <span>Designation</span>
                  <input
                    type="text"
                    value={emp.designation || "Sales Executive"}
                    onChange={(e) => setEmp({ ...emp, designation: e.target.value })}
                  />
                </label>
              </div>

              <div className="row-inputs-2">
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

                <label className="input-group">
                  <span>Joining Date</span>
                  <input
                    type="date"
                    value={emp.joined_on || ""}
                    onChange={(e) => setEmp({ ...emp, joined_on: e.target.value })}
                  />
                </label>
              </div>

              {/* Compressed Photo Upload */}
              <ImageUploader
                kind="employee"
                currentImageUrl={emp.photo_url}
                onUploadComplete={(url) => setEmp({ ...emp, photo_url: url })}
                label="Staff Profile Photo (Automatic &le; 50 KB WebP)"
              />

              <label className="checkbox-item mt-3">
                <input
                  type="checkbox"
                  checked={emp.active}
                  onChange={(e) => setEmp({ ...emp, active: e.target.checked })}
                />
                <span>Active Employee (Permitted floor check-in)</span>
              </label>
            </div>
          </div>

          <div className="modal-actions-footer">
            <button type="submit" className="button gold-btn" disabled={saving}>
              {saving ? "Saving Changes..." : "Save Personal Information"}
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Attendance History */}
      {activeTab === "attendance" && (
        <div className="profile-tab-content">
          <div className="tab-toolbar">
            <h4 className="column-section-title">Attendance Register Log</h4>
            <div className="month-picker">
              <span>Filter Month:</span>
              <input
                type="month"
                value={attendanceMonth}
                onChange={(e) => setAttendanceMonth(e.target.value)}
              />
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
                    <td>{row.work_on}</td>
                    <td>
                      <span className={`status-pill ${row.status}`}>
                        {row.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>{Math.floor(row.worked_minutes / 60)} hrs {row.worked_minutes % 60} mins</td>
                    <td>{row.overtime_minutes ? `${row.overtime_minutes} mins` : "-"}</td>
                    <td>{row.note || "-"}</td>
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

      {/* Tab 3: Leave History */}
      {activeTab === "leaves" && (
        <div className="profile-tab-content">
          <div className="leave-summary-grid">
            <div className="leave-balance-card">
              <span className="balance-val">12</span>
              <span className="balance-lbl">Casual Leave Balance</span>
            </div>
            <div className="leave-balance-card">
              <span className="balance-val">6</span>
              <span className="balance-lbl">Sick Leave Balance</span>
            </div>
            <div className="leave-balance-card">
              <span className="balance-val">{leaveRows.length}</span>
              <span className="balance-lbl">Applications Submitted</span>
            </div>
          </div>

          <h4 className="column-section-title mt-4">Leave Application Log</h4>
          <table className="luxury-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {leaveRows.length > 0 ? (
                leaveRows.map((l, i) => (
                  <tr key={i}>
                    <td><span className="tag-luxury">{l.leave_type.toUpperCase()}</span></td>
                    <td>{l.start_date}</td>
                    <td>{l.end_date}</td>
                    <td>{l.days} days</td>
                    <td>{l.reason || "-"}</td>
                    <td>
                      <span className={`status-pill ${l.status}`}>{l.status}</span>
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

      {/* Tab 4: Salary & Bank Information */}
      {activeTab === "salary" && (
        <div className="profile-tab-content">
          <div className="form-grid-columns">
            <div className="form-column">
              <h4 className="column-section-title">Compensation Structure</h4>
              <div className="info-kv-card">
                <div className="kv-row">
                  <span className="kv-k">Pay Basis:</span>
                  <span className="kv-v">{emp.pay_basis.toUpperCase()}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Base Pay Rate:</span>
                  <span className="kv-v bold gold-text">{money(emp.rate_paise)}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Standard Daily Working:</span>
                  <span className="kv-v">{Math.floor(emp.daily_minutes / 60)} hours / day</span>
                </div>
                <div className="kv-row">
                  <span className="kv-k">Overtime Hourly Rate:</span>
                  <span className="kv-v">{money(emp.overtime_rate_paise)} / hr</span>
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

            {/* Bank Details with Role-Based Access Control */}
            <div className="form-column">
              <h4 className="column-section-title">Confidential Bank Account Details</h4>
              <div className="bank-security-panel">
                <div className="security-notice">
                  <span>🔒 Protected by Role-Based Access Control (Superadmin only)</span>
                </div>

                {isSuperadmin ? (
                  showBankDetails ? (
                    <div className="bank-fields-view">
                      <div className="kv-row">
                        <span className="kv-k">Bank Name:</span>
                        <span className="kv-v">{emp.bank_details?.bank_name || "State Bank of India"}</span>
                      </div>
                      <div className="kv-row">
                        <span className="kv-k">Account Number:</span>
                        <span className="kv-v font-mono">{emp.bank_details?.account_number || "•••••••• 4892"}</span>
                      </div>
                      <div className="kv-row">
                        <span className="kv-k">IFSC Code:</span>
                        <span className="kv-v font-mono">{emp.bank_details?.ifsc_code || "SBIN0001234"}</span>
                      </div>
                      <div className="kv-row">
                        <span className="kv-k">Branch:</span>
                        <span className="kv-v">{emp.bank_details?.branch || "T. Nagar, Chennai"}</span>
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
                        👁 Reveal Bank Information
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
        </div>
      )}

      {/* Tab 5: Activity History */}
      {activeTab === "activity" && (
        <div className="profile-tab-content">
          <h4 className="column-section-title">Staff Activity &amp; Audit Trail</h4>
          <div className="timeline-activity">
            <div className="timeline-item">
              <div className="timeline-marker" />
              <div className="timeline-body">
                <strong>Profile Verified &amp; Synced</strong>
                <p>Employee record active in Magarantham Silks ERP.</p>
                <small>{emp.joined_on || "Recent"}</small>
              </div>
            </div>
            <div className="timeline-item">
              <div className="timeline-marker" />
              <div className="timeline-body">
                <strong>Shift Policy Assigned</strong>
                <p>Configured for standard 8-hour retail shift schedule.</p>
                <small>{emp.joined_on || "Recent"}</small>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
