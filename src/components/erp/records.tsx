'use client';
import { useEffect, useState } from 'react';
import { erpForms } from '@/lib/erp-fields';
import { indiaDate } from '@/lib/barcode';
import { Profile } from '@/lib/core';
import { api } from '../api';
import { ERPInput, References, Row, useERP } from './shared';
import { EmployeeProfileView } from '../admin/employee-profile';

export function ERPRecords({
  module,
  refs,
  refreshRefs,
  profile,
}: {
  module: string;
  refs: References;
  refreshRefs: () => Promise<void>;
  profile?: Profile;
}) {
  const form = erpForms[module];
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Row | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [login, setLogin] = useState<Row | null>(null);
  const { busy, send, notice } = useERP();

  async function load(page = 0) {
    try {
      const r = await api<Row>(`/api/erp/${form.entity}?page=${page}`);
      setRows((old) => (page === 0 ? r.rows : [...old, ...r.rows]));
      setNextPage(r.nextPage);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    setEditing(null);
    setViewingEmployee(null);
    setLogin(null);
    void load();
  }, [module]);

  function edit(r: Row) {
    setEditing({
      ...form.defaults,
      ...Object.fromEntries(
        form.fields.map((f) => [
          f.key,
          r[f.key] ??
            form.defaults[f.key] ??
            (f.type === 'number'
              ? 0
              : f.type === 'check'
                ? false
                : f.nullable
                  ? null
                  : ''),
        ]),
      ),
      id: r.id || crypto.randomUUID(),
      ...(module === 'employees'
        ? { scheduled_units: r.scheduled_units || 26 }
        : {}),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (viewingEmployee && module === 'employees') {
    return (
      <EmployeeProfileView
        employee={viewingEmployee as any}
        profile={profile || ({ role: 'superadmin', permissions: ['superadmin'] } as any)}
        onBack={() => setViewingEmployee(null)}
        onUpdated={async () => {
          await load();
          await refreshRefs();
        }}
      />
    );
  }

  return (
    <div className="erp-module">
      <div className="button-row" style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: 20 }}>
        <button
          className="button"
          onClick={() =>
            edit(
              module === 'employees'
                ? {
                    joined_on: indiaDate(),
                    policy_id: refs.salary_policies?.find((p) => p.active)?.id,
                  }
                : {},
            )
          }
          disabled={module === 'pos-settings'}
        >
          Add {module === 'employees' ? 'staff member' : 'new record'} ＋
        </button>
        <button className="button button-outline" onClick={() => void load()}>
          Refresh records
        </button>
        {module === 'pos-settings' && (
          <button
            className="button"
            onClick={() => edit(rows[0] || form.defaults)}
          >
            Edit POS settings
          </button>
        )}
      </div>

      {editing && (
        <form
          className="form-panel"
          style={{ marginBottom: 24 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(
              form.fields.map((f) => [
                f.key,
                editing[f.key] ??
                  (f.nullable
                    ? null
                    : f.type === 'check'
                      ? false
                      : f.type === 'number'
                        ? 0
                        : f.type === 'components' ||
                            f.type === 'tiers' ||
                            f.type === 'weekdays' ||
                            f.type === 'numbers'
                          ? []
                          : ''),
              ]),
            );
            if (module === 'employees')
              data.scheduled_units = editing.scheduled_units || 26;
            const result = await send(
              form.entity,
              { id: module === 'pos-settings' ? null : editing.id, data },
              async () => {
                await load();
                await refreshRefs();
              },
            );
            if (result) setEditing(null);
          }}
        >
          <h2 style={{ color: 'var(--erp-burgundy, #800020)' }}>
            {module === 'pos-settings'
              ? 'POS configuration'
              : 'Record details'}
            .
          </h2>
          {form.fields.map((f) => (
            <ERPInput
              key={f.key}
              field={f}
              value={editing[f.key]}
              refs={refs}
              data={editing}
              onChange={(v) =>
                setEditing({
                  ...editing,
                  [f.key]: v,
                  ...(f.key === 'scope' ? { target_id: '' } : {}),
                })
              }
            />
          ))}
          {module === 'discounts' && (
            <p className="subtle">
              The strongest active percentage across the product and its
              category/subcategory applies in both POS and the online shop. These
              percentages do not stack. POS walk-in discounts and online order
              coupons are separate.
            </p>
          )}
          {module === 'salary-policies' && (
            <p className="subtle">
              These are your shop rules. Monthly allowances and manual
              deductions are separate. Configure statutory deductions with your
              payroll adviser before use.
            </p>
          )}
          <div className="button-row" style={{ marginTop: 20 }}>
            <button disabled={busy} className="button">
              Save record
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => setEditing(null)}
            >
              Cancel editing
            </button>
          </div>
        </form>
      )}

      {login && (
        <form
          className="form-panel"
          style={{ marginBottom: 24 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const existing = String(f.get('existing') || '');
            const payload = existing
              ? {
                  employee_id: login.id,
                  existing_profile_id: existing,
                  role: 'billing',
                }
              : {
                  employee_id: login.id,
                  role: f.get('role'),
                  email: f.get('email'),
                  password: f.get('password'),
                };
            const r = await send('employee_login', payload, async () => {
              await load();
              await refreshRefs();
            });
            if (r) setLogin(null);
          }}
        >
          <h2 style={{ color: 'var(--erp-burgundy, #800020)' }}>
            Login for {login.name}.
          </h2>
          <p>
            No login is needed to keep attendance or run salary. Billing users
            can bill and see their own POS bills only. All staff logins require an
            authenticator.
          </p>
          <label>
            Link an existing staff login (optional)
            <select name="existing">
              <option value="">Create a new login</option>
              {(refs.profiles || [])
                .filter(
                  (p) =>
                    ['billing', 'manager'].includes(p.role) &&
                    !(refs.employees || []).some((e) => e.profile_id === p.id),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.email} · {p.role}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Role for a new login
            <select name="role">
              <option value="billing">Billing staff</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <label>
            Email for a new login
            <input type="email" name="email" maxLength={254} />
          </label>
          <label>
            Temporary password for a new login
            <input
              type="password"
              name="password"
              minLength={6}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <div className="button-row" style={{ marginTop: 20 }}>
            <button className="button" disabled={busy}>
              Create or link staff login
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => setLogin(null)}
            >
              Cancel login setup
            </button>
          </div>
        </form>
      )}

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Details</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name || r.business_name}</strong>
                  <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                    {r.code || r.slug || r.scope || r.email}
                  </small>
                </td>
                <td>
                  {module === 'categories'
                    ? r.parent_id
                      ? `Subcategory of ${
                          (refs.categories || []).find((p) => p.id === r.parent_id)
                            ?.name || 'main category'
                        }`
                      : 'Main category'
                    : module === 'discounts'
                      ? `${r.discount_bps / 100}% · ${
                          (refs.products || []).find(
                            (p) => p.id === r.target_id,
                          )?.name ||
                          (refs.categories || []).find(
                            (c) => c.id === r.target_id,
                          )?.name ||
                          ''
                        }`
                      : module === 'employees'
                        ? `${r.employment} · ${r.pay_basis} · ${r.rate_paise / 100} Rs`
                        : r.phone || r.divisor_mode || 'Configured'}
                </td>
                <td>
                  {r.active === false || r.enabled === false ? 'Off' : 'Active'}
                  {module === 'employees' && (
                    <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                      {r.profile_id ? 'Login linked' : 'No login'}
                    </small>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {module === 'employees' && (
                      <button
                        className="text-link"
                        style={{ color: 'var(--erp-burgundy, #800020)', fontWeight: 600 }}
                        onClick={() => setViewingEmployee(r)}
                      >
                        View Profile
                      </button>
                    )}
                    <button className="text-link" onClick={() => edit(r)}>
                      Edit
                    </button>
                    {module === 'employees' && !r.profile_id && r.active && (
                      <button className="text-link" onClick={() => setLogin(r)}>
                        Link login
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextPage !== null && (
        <div style={{ marginTop: 20 }}>
          <button
            className="button button-outline"
            disabled={busy}
            onClick={() => void load(nextPage)}
          >
            Load more records
          </button>
        </div>
      )}
    </div>
  );
}
