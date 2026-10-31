import Link from "next/link";
import { ClipboardCheck, FilePenLine, LayoutDashboard, UserRoundPlus, UsersRound } from "lucide-react";

const icons = {
  overview: LayoutDashboard,
  teams: UsersRound,
  affiliations: FilePenLine,
  review: ClipboardCheck,
  accounts: UserRoundPlus,
};

export type ManagementNavigationGroup = {
  label: string;
  items: { href: string; label: string; icon: keyof typeof icons }[];
};

export function ManagementNavigation({ groups, activeHref, onNavigate }: {
  groups: readonly ManagementNavigationGroup[];
  activeHref: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Gestión de la liga" className="space-y-5 px-3 py-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="sidebar-muted mb-2 px-3 text-xs font-semibold tracking-widest uppercase">{group.label}</p>
          <ul className="space-y-1.5">
            {group.items.map((item) => {
              const Icon = icons[item.icon];
              const active = item.href === activeHref;
              return (
                <li key={item.href}>
                  <Link href={item.href} aria-current={active ? "page" : undefined} onNavigate={onNavigate}
                    className={`sidebar-link flex min-h-11 items-center gap-3 rounded-xl border-l-4 px-3 py-2.5 text-sm font-medium transition-colors ${active
                      ? "border-accent font-semibold"
                      : "border-transparent"}`}>
                    <Icon size={21} aria-hidden="true" className="shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
