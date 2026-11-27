import { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Calculator,
  Calendar,
  Cpu,
  Database,
  Globe,
  Lock,
  LogIn,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.tsx';
import { LANG_LABELS, Lang } from '../i18n/translations.ts';

export type ActiveTab =
  | 'comparator'
  | 'timeline'
  | 'simulator'
  | 'ai2027'
  | 'codex'
  | 'harvester'
  | 'admin';

export interface AuthUser {
  email: string;
  name: string;
  isAdmin: boolean;
  provider: 'google' | 'admin-key';
  picture?: string;
}

interface TopHudBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  lastHarvestAt: string;
  modelCount: number;
  benchmarkCount: number;
  isHarvesting: boolean;
  onTriggerHarvest: () => void;
  lastDeltaCount: number;
  user: AuthUser | null;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export function TopHudBar({
  activeTab,
  onTabChange,
  lastHarvestAt,
  modelCount,
  benchmarkCount,
  isHarvesting,
  onTriggerHarvest,
  lastDeltaCount,
  user,
  onOpenLogin,
  onLogout,
}: TopHudBarProps) {
  const { lang, setLang, t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'fr-FR';
  const formattedDate = new Date(lastHarvestAt).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleNav = (tab: ActiveTab) => {
    onTabChange(tab);
    setMobileMenuOpen(false);
  };

  const navItems: Array<{ id: ActiveTab; label: string; icon: React.ReactNode; badge?: number; adminOnly?: boolean }> = [
    { id: 'comparator', label: t('tabComparator'), icon: <BarChart3 size={15} className="me-1" /> },
    { id: 'timeline', label: t('tabTimeline'), icon: <Calendar size={15} className="me-1" /> },
    { id: 'simulator', label: t('tabSimulator'), icon: <Calculator size={15} className="me-1" /> },
    { id: 'ai2027', label: t('tabAi2027'), icon: <TrendingUp size={15} className="me-1" /> },
    { id: 'codex', label: t('tabCodex'), icon: <BookOpen size={15} className="me-1" /> },
    {
      id: 'harvester',
      label: t('tabHarvester'),
      icon: <Database size={15} className="me-1" />,
      badge: lastDeltaCount > 0 ? lastDeltaCount : undefined,
      adminOnly: true,
    },
    {
      id: 'admin',
      label: t('tabAdmin'),
      icon: <ShieldCheck size={15} className="me-1" />,
      adminOnly: true,
    },
  ];

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user?.isAdmin);

  return (
    <header className="navbar navbar-expand-lg navbar-tabler-custom sticky-top d-print-none flex-column align-items-stretch p-0">
      <div className="container-xl py-2 d-flex align-items-center justify-content-between gap-2">
        {/* Brand */}
        <div
          className="navbar-brand d-flex align-items-center gap-2 p-0 m-0 cursor-pointer"
          onClick={() => handleNav('comparator')}
        >
          <span className="avatar avatar-sm bg-primary-lt text-primary rounded">
            <Cpu size={18} />
          </span>
          <div>
            <div className="fw-bold lh-1" style={{ fontSize: '0.96rem' }}>
              {t('brand')}
            </div>
            <div className="text-secondary d-none d-sm-block" style={{ fontSize: '0.7rem' }}>
              {modelCount} {t('modelsCount')} · {benchmarkCount} {t('benchmarksCount')} · {t('updatedShort')} {formattedDate}
            </div>
          </div>
        </div>

        {/* Desktop Nav */}
        <div className="d-none d-lg-flex align-items-center gap-1 flex-wrap">
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              className={`btn btn-sm ${activeTab === item.id ? 'btn-primary' : 'btn-ghost-secondary'}`}
              onClick={() => handleNav(item.id)}
            >
              {item.icon}
              {item.label}
              {item.badge !== undefined && (
                <span className="badge bg-green-lt text-green ms-1">+{item.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Right Controls: Language + Swagger + Harvest (admin) + Auth + Mobile Menu Toggle */}
        <div className="d-flex align-items-center gap-2">
          {/* Language Switcher FR | EN | ES */}
          <div className="btn-group btn-group-sm" role="group" aria-label="Language">
            {(['fr', 'en', 'es'] as Lang[]).map((code) => (
              <button
                key={code}
                className={`btn px-2 ${lang === code ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setLang(code)}
                style={{ fontSize: '0.7rem' }}
              >
                {LANG_LABELS[code]}
              </button>
            ))}
          </div>

          {/* Desktop-only quick actions */}
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm btn-outline-primary d-none d-xl-inline-flex align-items-center"
          >
            {t('swaggerBtn')}
          </a>

          {user?.isAdmin && (
            <button
              className="btn btn-sm btn-outline-success d-none d-md-inline-flex align-items-center gap-1"
              onClick={onTriggerHarvest}
              disabled={isHarvesting}
            >
              <RefreshCw size={13} className={isHarvesting ? 'spin' : ''} />
              {isHarvesting ? t('harvestingBtn') : t('harvestBtn')}
            </button>
          )}

          {user ? (
            <button
              className="btn btn-sm btn-outline-secondary d-none d-sm-inline-flex align-items-center gap-1"
              onClick={onLogout}
              title={user.email}
            >
              <LogOut size={13} />
              <span className="d-none d-md-inline">{t('logoutBtn')}</span>
            </button>
          ) : (
            <button
              className="btn btn-sm btn-outline-secondary d-none d-sm-inline-flex align-items-center gap-1"
              onClick={onOpenLogin}
            >
              <LogIn size={13} />
              <span className="d-none d-md-inline">{t('loginBtn')}</span>
            </button>
          )}

          {/* Mobile Hamburger Button */}
          <button
            className="btn btn-sm btn-outline-secondary d-lg-none px-2"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile Collapsible Drawer */}
      {mobileMenuOpen && (
        <div className="mobile-nav-drawer d-lg-none">
          <div className="d-flex flex-column gap-2">
            <div className="d-grid gap-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {visibleNavItems.map((item) => (
                <button
                  key={item.id}
                  className={`btn btn-sm justify-content-start ${
                    activeTab === item.id ? 'btn-primary' : 'btn-outline-secondary'
                  }`}
                  onClick={() => handleNav(item.id)}
                >
                  {item.icon}
                  <span className="text-truncate">{item.label}</span>
                </button>
              ))}
            </div>

            <div className="d-flex flex-wrap gap-2 pt-2 border-top">
              <a
                href="/api/docs"
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-outline-primary flex-fill"
              >
                <Globe size={13} className="me-1" />
                {t('swaggerBtn')}
              </a>

              {user?.isAdmin && (
                <button
                  className="btn btn-sm btn-success flex-fill d-inline-flex align-items-center justify-content-center gap-1"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onTriggerHarvest();
                  }}
                  disabled={isHarvesting}
                >
                  <RefreshCw size={13} className={isHarvesting ? 'spin' : ''} />
                  {t('harvestBtn')}
                </button>
              )}

              {user ? (
                <button
                  className="btn btn-sm btn-outline-secondary flex-fill"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={13} className="me-1" />
                  {t('logoutBtn')} ({user.name})
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-outline-warning flex-fill"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenLogin();
                  }}
                >
                  <Lock size={13} className="me-1" />
                  {t('loginBtn')} ({t('adminBadge')})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
