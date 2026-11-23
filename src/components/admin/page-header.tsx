import { ReactNode } from "react";
import { pageMeta } from "@/lib/admin-pages";

/** Standard header for every ERP page: title, helper line and right-aligned actions. */
export function PageHeader({
  section,
  title,
  subtitle,
  actions,
}: {
  section: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const meta = pageMeta(section);
  return (
    <header className="ms-page-head">
      <div>
        <h1>{title || meta.title}</h1>
        {(subtitle ?? meta.subtitle) && <p>{subtitle ?? meta.subtitle}</p>}
      </div>
      {actions && <div className="ms-page-actions">{actions}</div>}
    </header>
  );
}
