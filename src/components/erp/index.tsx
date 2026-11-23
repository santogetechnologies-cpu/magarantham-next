'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Profile } from '@/lib/core';
import { erpModules } from '@/lib/erp-fields';
import { api } from '../api';
import { ERPRecords } from './records';
import { Purchases } from './purchases';
import { Expenses } from './expenses';
import { POS } from './pos';
import { Labels } from './labels';
import { Attendance } from './attendance';
import { Payroll } from './payroll';
import { EmployeesManager } from './employees';
import { StaffLoginsManager } from './staff-logins';
import { SalaryPoliciesManager } from './salary-policies';
import { Reports } from './reports';
import { CategoriesManager } from './categories';
import { References } from './shared';
import { AdminSidebar } from '../admin/sidebar';
import { AdminTopbar } from '../admin/topbar';

export function ERP({
  module,
  profile,
}: {
  module: string;
  profile: Profile;
}) {
  const [refs, setRefs] = useState<References>({});
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function refreshRefs() {
    try {
      setRefs(await api<References>('/api/erp/reference'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refreshRefs();
  }, [module]);

  const moduleConfig = erpModules[module];
  const pageTitle = moduleConfig?.title || module;

  return (
    <div className="luxury-admin-shell">
      <AdminSidebar
        currentSection={module}
        profile={profile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="luxury-admin-viewport">
        <AdminTopbar
          section={module}
          profile={profile}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <main className="luxury-admin-main">
          <header className="section-heading" style={{ marginBottom: 24 }}>
            <div>
              <p className="eyebrow">மகரந்தம் சில்க்ஸ் · ONE SHOP · ONE STOCK LEDGER</p>
              <h1 style={{ fontFamily: 'var(--serif)', fontSize: 32, margin: 0 }}>
                {pageTitle}.
              </h1>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                type="button"
                className="button button-outline"
                onClick={() => void refreshRefs()}
              >
                Refresh Data
              </button>
              <Link className="text-link" href="/shop" target="_blank">
                Online Shop ↗
              </Link>
            </div>
          </header>

          {error && (
            <div role="alert" className="notice" style={{ marginBottom: 20 }}>
              {error}
            </div>
          )}

          {module === 'pos' ? (
            <POS profile={profile} />
          ) : module === 'categories' ? (
            <CategoriesManager refs={refs} onChanged={() => void refreshRefs()} />
          ) : module === 'purchases' ? (
            <Purchases refs={refs} />
          ) : module === 'labels' ? (
            <Labels refs={refs} />
          ) : module === 'expenses' ? (
            <Expenses refs={refs} profile={profile} />
          ) : module === 'employees' ? (
            <EmployeesManager
              refs={refs}
              refreshRefs={refreshRefs}
              profile={profile}
            />
          ) : module === 'staff-logins' ? (
            <StaffLoginsManager />
          ) : module === 'salary-policies' ? (
            <SalaryPoliciesManager refreshRefs={refreshRefs} />
          ) : module === 'attendance' ? (
            <Attendance refs={refs} />
          ) : module === 'payroll' ? (
            <Payroll refs={refs} />
          ) : module === 'reports' ? (
            <Reports />
          ) : (
            <ERPRecords
              module={module}
              refs={refs}
              refreshRefs={refreshRefs}
              profile={profile}
            />
          )}
        </main>
      </div>
    </div>
  );
}
