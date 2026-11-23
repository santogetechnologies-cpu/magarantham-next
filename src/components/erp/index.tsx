'use client';
import { useEffect, useState } from 'react';
import { Profile } from '@/lib/core';
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
import { PageHeader } from '../admin/page-header';
import { DiscountsManager } from './discounts';

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

        <main className="luxury-admin-main ms-main" key={module}>
          <PageHeader
            section={module}
            actions={
              <>
                <button
                  type="button"
                  className="ms-btn ms-btn-ghost ms-btn-sm"
                  onClick={() => void refreshRefs()}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
                  Refresh
                </button>
              </>
            }
          />

          {error && (
            <div role="alert" className="ms-alert ms-alert-danger">
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
          ) : module === 'discounts' ? (
            <DiscountsManager refs={refs} />
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
