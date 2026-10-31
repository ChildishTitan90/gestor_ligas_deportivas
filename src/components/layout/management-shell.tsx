"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Shield, X } from "lucide-react";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import type { AccountPresentation } from "@/features/auth/types";
import { ManagementNavigation, type ManagementNavigationGroup } from "./management-navigation";

export function ManagementShell({ account, navigation, children }: {
  account: Pick<AccountPresentation, "username" | "initials" | "roleNames">;
  navigation: readonly ManagementNavigationGroup[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const activeHref = /^\/affiliations\/[^/]+\/correct\/?$/.test(pathname) ? "/affiliations/new" : pathname;
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previousPathname, setPreviousPathname] = useState(pathname);
  const sidebarId = useId();
  const sidebar = useRef<HTMLElement>(null);
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const mobileClose = useRef<HTMLButtonElement>(null);

  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const returnFocus = mobileTrigger.current;
    const returnDesktopFocus = desktopTrigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileClose.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
      } else if (event.key === "Tab") {
        const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !sidebar.current?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebar.current?.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    }
    const desktop = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() { if (desktop.matches) setMobileOpen(false); }
    desktop.addEventListener("change", closeOnDesktop);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", closeOnDesktop);
      const target = desktop.matches ? returnDesktopFocus : returnFocus;
      if (target?.isConnected) target.focus();
    };
  }, [mobileOpen]);

  return (
    <div className={`min-h-svh flex-1 lg:grid ${expanded ? "lg:grid-cols-[15.5rem_minmax(0,1fr)]" : "lg:grid-cols-1"}`}>
      <a href="#management-content" className="sr-only fixed top-4 left-4 z-50 rounded-xl bg-surface px-5 py-3 font-semibold text-primary focus:not-sr-only">
        Saltar al contenido
      </a>
      {mobileOpen && <div aria-hidden="true" onClick={() => setMobileOpen(false)} className="management-overlay fixed inset-0 z-30 lg:hidden" />}
      <aside ref={sidebar} id={sidebarId} role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined}
        aria-label="Menú de gestión"
        className={`management-sidebar ${mobileOpen ? "fixed inset-y-0 left-0 z-40 flex w-[min(18rem,calc(100vw-2rem))]" : "hidden"} flex-col ${expanded ? "lg:sticky lg:top-0 lg:flex lg:h-svh lg:w-auto" : "lg:hidden"}`}>
        <div className="management-brand-row sidebar-divider flex shrink-0 items-center gap-2 border-b px-4">
          <Link href="/access" aria-label="Liga Municipal de Morelia: mi panel"
          onNavigate={() => setMobileOpen(false)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg focus-visible:-outline-offset-4">
          <span className="sidebar-brand-mark sidebar-divider flex size-10 shrink-0 items-center justify-center rounded-xl border">
            <Shield size={25} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-base font-semibold tracking-tight">Liga Municipal</span>
            <span className="sidebar-muted mt-0.5 block text-xs tracking-wide">Fútbol · Morelia</span>
          </span>
          </Link>
          <button ref={mobileClose} type="button" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú de gestión"
            className="sidebar-link flex size-11 shrink-0 items-center justify-center rounded-xl lg:hidden">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ManagementNavigation groups={navigation} activeHref={activeHref} onNavigate={() => setMobileOpen(false)} />
        </div>
        <div className="management-footer-row sidebar-divider flex shrink-0 flex-col justify-center border-t px-3 py-2 lg:py-3">
          <SignOutButton variant="sidebar" />
        </div>
      </aside>
      <div className="min-w-0" inert={mobileOpen}>
        <header className="management-header-row sticky top-0 z-20 flex items-center border-b border-border bg-surface">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <button ref={desktopTrigger} type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={sidebarId}
                aria-label={expanded ? "Ocultar menú de gestión" : "Mostrar menú de gestión"}
                className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-border text-primary hover:bg-soft lg:flex">
                {expanded ? <PanelLeftClose size={22} aria-hidden="true" /> : <PanelLeftOpen size={22} aria-hidden="true" />}
              </button>
              <button ref={mobileTrigger} type="button" onClick={() => setMobileOpen(true)} aria-expanded={mobileOpen} aria-controls={sidebarId}
                aria-label="Abrir menú de gestión"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-primary hover:bg-soft lg:hidden">
                <Menu size={22} aria-hidden="true" />
              </button>
              <p className="hidden text-sm font-semibold text-primary sm:block">Liga Municipal · Morelia</p>
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <AccountMenu username={account.username} initials={account.initials} roleNames={account.roleNames} />
            </div>
          </div>
        </header>
        <main id="management-content" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-10 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
