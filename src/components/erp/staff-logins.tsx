'use client';
import React, { useEffect, useState } from 'react';
import { indiaDate } from '@/lib/barcode';
import { money } from '@/lib/core';
import { api } from '../api';
import { Row, useERP } from './shared';

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function StaffLoginsManager() {
  const today = indiaDate();
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const { notice } = useERP();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStaff, setSelectedStaff] = useState('all');
  const [selectedRole, setSelectedRole] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<'all' | 'staff.login' | 'staff.logout'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'logged_out'>('all');

  async function load(targetDate = date) {
    setLoading(true);
    try {
      const res = await api<Row>(
        `/api/admin/staff-logins?date=${encodeURIComponent(targetDate)}`,
      );
      setData(res);
    } catch (e) {
      notice((e as Error).message || 'Could not load staff logins.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(date);
  }, [date]);

  const loggedIn = (data?.loggedInStaff || []) as Row[];
  const notLoggedIn = (data?.notLoggedInStaff || []) as Row[];
  const events = (data?.events || []) as Row[];
  const summary = (data?.summary || {}) as Row;
  const isToday = date === today;

  // Extract unique staff options for dropdown
  const staffOptions = React.useMemo(() => {
    const map = new Map<string, { label: string; email: string; role: string }>();
    for (const s of loggedIn) {
      const key = String(s.email || s.name);
      if (!map.has(key)) {
        map.set(key, {
          label: String(s.name || s.email),
          email: String(s.email || ''),
          role: String(s.role || ''),
        });
      }
    }
    for (const s of notLoggedIn) {
      const key = String(s.email || s.name);
      if (!map.has(key)) {
        map.set(key, {
          label: String(s.name || s.email),
          email: String(s.email || ''),
          role: String(s.role || ''),
        });
      }
    }
    for (const ev of events) {
      const key = String(ev.email || ev.name);
      if (!map.has(key)) {
        map.set(key, {
          label: String(ev.name || ev.email),
          email: String(ev.email || ''),
          role: String(ev.role || ''),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [loggedIn, notLoggedIn, events]);

  // Extract unique roles
  const roleOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of loggedIn) if (s.role) set.add(String(s.role));
    for (const s of notLoggedIn) if (s.role) set.add(String(s.role));
    for (const ev of events) if (ev.role) set.add(String(ev.role));
    return Array.from(set).sort();
  }, [loggedIn, notLoggedIn, events]);

  // Helper filter matcher for staff & role & text search
  function matchStaffAndRole(row: Row): boolean {
    if (selectedStaff !== 'all') {
      const staffKey = String(row.email || row.name || '');
      if (staffKey !== selectedStaff && String(row.email) !== selectedStaff) {
        return false;
      }
    }
    if (selectedRole !== 'all') {
      if (String(row.role || '').toLowerCase() !== selectedRole.toLowerCase()) {
        return false;
      }
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const combined = `${row.name || ''} ${row.email || ''} ${row.code || ''} ${row.role || ''}`.toLowerCase();
      if (!combined.includes(q)) {
        return false;
      }
    }
    return true;
  }

  // Filtered Events (Login & Logout History)
  const filteredEvents = React.useMemo(() => {
    return events.filter((ev) => {
      if (!matchStaffAndRole(ev)) return false;
      if (selectedEvent !== 'all' && ev.action !== selectedEvent) return false;
      return true;
    });
  }, [events, selectedStaff, selectedRole, searchTerm, selectedEvent]);

  // Filtered Logged In Staff
  const filteredLoggedIn = React.useMemo(() => {
    return loggedIn.filter((s) => {
      if (!matchStaffAndRole(s)) return false;
      if (selectedStatus === 'active' && !s.currently_active) return false;
      if (selectedStatus === 'logged_out' && s.currently_active) return false;
      return true;
    });
  }, [loggedIn, selectedStaff, selectedRole, searchTerm, selectedStatus]);

  // Filtered Not Logged In Staff
  const filteredNotLoggedIn = React.useMemo(() => {
    return notLoggedIn.filter((s) => matchStaffAndRole(s));
  }, [notLoggedIn, selectedStaff, selectedRole, searchTerm]);

  // Event counts
  const loginEventsCount = events.filter((e) => e.action === 'staff.login').length;
  const logoutEventsCount = events.filter((e) => e.action === 'staff.logout').length;

  // Staff status counts
  const activeStaffCount = loggedIn.filter((s) => s.currently_active).length;
  const loggedOutStaffCount = loggedIn.filter((s) => !s.currently_active).length;

  const hasActiveFilter =
    searchTerm.trim() !== '' ||
    selectedStaff !== 'all' ||
    selectedRole !== 'all' ||
    selectedEvent !== 'all' ||
    selectedStatus !== 'all';

  function clearFilters() {
    setSearchTerm('');
    setSelectedStaff('all');
    setSelectedRole('all');
    setSelectedEvent('all');
    setSelectedStatus('all');
  }

  return (
    <div className="sp-root">
      {/* Date Selector Bar */}
      <div className="sp-panel" style={{ padding: '14px 18px' }}>
        <div className="sp-rollcall-top" style={{ paddingBottom: 0, marginBottom: 0, borderBottom: 0 }}>
          <div className="sp-date-nav">
            <button
              type="button"
              className="button outline-btn mini-btn"
              onClick={() => setDate(shiftDate(date, -1))}
            >
              ← Prev Day
            </button>
            <input
              type="date"
              max={today}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="sp-date-input"
            />
            <button
              type="button"
              className="button outline-btn mini-btn"
              disabled={date >= today}
              onClick={() => {
                const next = shiftDate(date, 1);
                setDate(next > today ? today : next);
              }}
            >
              Next Day →
            </button>
            {!isToday && (
              <button
                type="button"
                className="text-link"
                onClick={() => setDate(today)}
              >
                Jump to Today
              </button>
            )}
          </div>

          <button
            type="button"
            className="button outline-btn mini-btn"
            disabled={loading}
            onClick={() => void load(date)}
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card">
          <span>{isToday ? 'Logged In Today' : `Logged In (${date})`}</span>
          <strong>{summary.logged_in_count ?? 0}</strong>
          <small>out of {summary.total_staff_accounts ?? 0} staff accounts</small>
        </div>
        <div className="sp-kpi-card">
          <span>Not Logged In</span>
          <strong>{summary.not_logged_in_count ?? 0}</strong>
          <small>No login recorded on {date}</small>
        </div>
        <div className="sp-kpi-card">
          <span>POS Bills {isToday ? 'Today' : `(${date})`}</span>
          <strong>{summary.total_bills_today ?? 0}</strong>
          <small>Sales: {money(Number(summary.total_sales_paise_today || 0))}</small>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="sp-panel" style={{ padding: '14px 18px', background: '#FFFDF9' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          {/* Search Box */}
          <div style={{ flex: '1 1 200px', minWidth: '180px', position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--erp-text-muted)',
                fontSize: '13px',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search staff name, email, code…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="sp-filter-input"
              style={{
                width: '100%',
                height: '36px',
                paddingLeft: '32px',
                paddingRight: searchTerm ? '30px' : '12px',
                border: '1px solid var(--erp-border)',
                borderRadius: '8px',
                fontSize: '13px',
                background: '#FFFFFF',
                boxSizing: 'border-box',
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--erp-text-muted)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '4px',
                }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Staff Member Selector */}
          <div style={{ flex: '0 1 180px', minWidth: '150px' }}>
            <select
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                border: '1px solid var(--erp-border)',
                borderRadius: '8px',
                fontSize: '13px',
                background: '#FFFFFF',
                boxSizing: 'border-box',
                color: 'var(--erp-text)',
              }}
            >
              <option value="all">All Staff ({staffOptions.length})</option>
              {staffOptions.map((st) => (
                <option key={st.email} value={st.email}>
                  {st.label} {st.role ? `(${st.role})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Role Selector */}
          <div style={{ flex: '0 1 140px', minWidth: '120px' }}>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                border: '1px solid var(--erp-border)',
                borderRadius: '8px',
                fontSize: '13px',
                background: '#FFFFFF',
                boxSizing: 'border-box',
                textTransform: 'capitalize',
                color: 'var(--erp-text)',
              }}
            >
              <option value="all">All Roles</option>
              {roleOptions.map((r) => (
                <option key={r} value={r} style={{ textTransform: 'capitalize' }}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Event Filter (Login vs Logout) */}
          <div style={{ flex: '0 1 150px', minWidth: '130px' }}>
            <select
              value={selectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value as 'all' | 'staff.login' | 'staff.logout')}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                border: '1px solid var(--erp-border)',
                borderRadius: '8px',
                fontSize: '13px',
                background: '#FFFFFF',
                boxSizing: 'border-box',
                color: 'var(--erp-text)',
              }}
            >
              <option value="all">All Events</option>
              <option value="staff.login">✓ Logged In Only</option>
              <option value="staff.logout">↳ Logged Out Only</option>
            </select>
          </div>

          {/* Reset Filters */}
          {hasActiveFilter && (
            <button
              type="button"
              className="button outline-btn mini-btn"
              onClick={clearFilters}
              style={{
                height: '36px',
                padding: '0 12px',
                color: '#991B1B',
                borderColor: '#FCA5A5',
                background: '#FEF2F2',
                fontWeight: 600,
              }}
            >
              ✕ Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Staff Who Logged In Table */}
      <section className="table-widget-panel">
        <div className="widget-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div className="widget-title-group">
            <span className="widget-badge-gold">
              {isToday ? 'Today' : date}
            </span>
            <h3>Staff Who Logged In</h3>
            <span style={{ fontSize: 12, color: 'var(--erp-text-muted)', marginLeft: 6 }}>
              {filteredLoggedIn.length !== loggedIn.length
                ? `Showing ${filteredLoggedIn.length} of ${loggedIn.length}`
                : `${loggedIn.length} staff member${loggedIn.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {/* Quick Status Filter Chips */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              className={`mini-filter-chip ${selectedStatus === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('all')}
            >
              All ({loggedIn.length})
            </button>
            <button
              type="button"
              className={`mini-filter-chip ${selectedStatus === 'active' ? 'active-green' : ''}`}
              onClick={() => setSelectedStatus(selectedStatus === 'active' ? 'all' : 'active')}
            >
              ● Active Now ({activeStaffCount})
            </button>
            <button
              type="button"
              className={`mini-filter-chip ${selectedStatus === 'logged_out' ? 'active-amber' : ''}`}
              onClick={() => setSelectedStatus(selectedStatus === 'logged_out' ? 'all' : 'logged_out')}
            >
              ○ Logged Out ({loggedOutStaffCount})
            </button>
          </div>
        </div>

        <div className="table-responsive-wrapper">
          <table className="luxury-table">
            <thead>
              <tr>
                <th>Staff Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Login Time</th>
                <th>Logout / Status</th>
                <th>POS Bills</th>
                <th>Sales</th>
              </tr>
            </thead>
            <tbody>
              {filteredLoggedIn.length > 0 ? (
                filteredLoggedIn.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="sp-staff-cell">
                        <span className="sp-avatar">
                          {String(s.name || 'S').slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong style={{ color: 'var(--erp-maroon)' }}>{s.name}</strong>
                          {s.code && (
                            <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                              {s.code}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>{s.email}</td>
                    <td>
                      <span className="pill-status status-processing" style={{ textTransform: 'capitalize' }}>
                        {s.role}
                      </span>
                    </td>
                    <td className="date-cell">
                      <strong>{fmtTime(s.last_login_at)}</strong>
                      {s.login_count > 1 && (
                        <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                          First: {fmtTime(s.first_login_at)} ({s.login_count}×)
                        </small>
                      )}
                    </td>
                    <td>
                      {s.currently_active ? (
                        <span className="pill-status status-paid">Logged In</span>
                      ) : (
                        <span className="pill-status status-pending">
                          Logged Out · {fmtTime(s.last_logout_at)}
                        </span>
                      )}
                    </td>
                    <td>{s.pos_bills_today || 0}</td>
                    <td className="money-cell">
                      {money(Number(s.pos_sales_paise_today || 0))}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="table-empty-cell">
                    {loading
                      ? 'Loading staff login details…'
                      : hasActiveFilter
                      ? (
                        <div>
                          <span style={{ display: 'block', marginBottom: '8px' }}>
                            No staff members match the selected filters.
                          </span>
                          <button
                            type="button"
                            className="button outline-btn mini-btn"
                            onClick={clearFilters}
                          >
                            Reset Filters
                          </button>
                        </div>
                      )
                      : `No staff logins recorded for ${date}.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Login & Logout Activity Log */}
      {events.length > 0 && (
        <section className="table-widget-panel">
          <div className="widget-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <div className="widget-title-group">
              <span className="widget-badge-gold">Activity</span>
              <h3>Login &amp; Logout History ({date})</h3>
              <span style={{ fontSize: 12, color: 'var(--erp-text-muted)', marginLeft: 6 }}>
                {filteredEvents.length !== events.length
                  ? `Showing ${filteredEvents.length} of ${events.length}`
                  : `${events.length} event${events.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {/* Quick Event Filter Chips */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className={`mini-filter-chip ${selectedEvent === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedEvent('all')}
              >
                All ({events.length})
              </button>
              <button
                type="button"
                className={`mini-filter-chip ${selectedEvent === 'staff.login' ? 'active-green' : ''}`}
                onClick={() => setSelectedEvent(selectedEvent === 'staff.login' ? 'all' : 'staff.login')}
              >
                ✓ Logged In ({loginEventsCount})
              </button>
              <button
                type="button"
                className={`mini-filter-chip ${selectedEvent === 'staff.logout' ? 'active-amber' : ''}`}
                onClick={() => setSelectedEvent(selectedEvent === 'staff.logout' ? 'all' : 'staff.logout')}
              >
                ↳ Logged Out ({logoutEventsCount})
              </button>
            </div>
          </div>
          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Staff</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length > 0 ? (
                  filteredEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td className="date-cell">
                        <strong>{fmtTime(ev.at)}</strong>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--erp-maroon)' }}>{ev.name}</strong>
                        {ev.code && (
                          <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                            {ev.code}
                          </small>
                        )}
                      </td>
                      <td>{ev.email}</td>
                      <td style={{ textTransform: 'capitalize' }}>{ev.role}</td>
                      <td>
                        <span
                          className={`pill-status ${
                            ev.action === 'staff.login' ? 'status-paid' : 'status-pending'
                          }`}
                        >
                          {ev.action === 'staff.login' ? 'Logged In' : 'Logged Out'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty-cell">
                      <span style={{ display: 'block', marginBottom: '8px' }}>
                        No login or logout events match the selected filters.
                      </span>
                      <button
                        type="button"
                        className="button outline-btn mini-btn"
                        onClick={clearFilters}
                      >
                        Reset Filters
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Not Logged In Yet */}
      {filteredNotLoggedIn.length > 0 && (
        <section className="table-widget-panel">
          <div className="widget-header">
            <div className="widget-title-group">
              <span className="widget-badge-gold">Not Active</span>
              <h3>Staff Not Logged In ({isToday ? 'Today' : date})</h3>
              {filteredNotLoggedIn.length !== notLoggedIn.length && (
                <span style={{ fontSize: 12, color: 'var(--erp-text-muted)', marginLeft: 6 }}>
                  Showing {filteredNotLoggedIn.length} of {notLoggedIn.length}
                </span>
              )}
            </div>
          </div>
          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Staff Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Last Login Ever</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredNotLoggedIn.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.code && (
                        <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                          {s.code}
                        </small>
                      )}
                    </td>
                    <td>{s.email}</td>
                    <td style={{ textTransform: 'capitalize' }}>{s.role}</td>
                    <td className="date-cell">{fmtDateTime(s.last_seen_ever)}</td>
                    <td>
                      <span
                        className={`pill-status ${
                          s.suspended ? 'status-pending' : 'status-paid'
                        }`}
                      >
                        {s.suspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
