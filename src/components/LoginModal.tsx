import { useEffect, useRef, useState } from 'react';
import { KeyRound, Lock, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.tsx';
import type { AuthUser } from './TopHudBar.tsx';

interface LoginModalProps {
  open: boolean;
  googleClientId: string | null;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: {
            client_id: string;
            callback: (res: { credential: string }) => void;
          }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export function LoginModal({ open, googleClientId, onClose, onSuccess }: LoginModalProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !googleClientId) return;

    const initGoogle = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setSubmitting(true);
          setError(null);
          try {
            const res = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential }),
            });
            const data = (await res.json()) as { user?: AuthUser; error?: string };
            if (!res.ok || !data.user) {
              setError(data.error ?? 'Échec connexion Google');
              return;
            }
            onSuccess(data.user);
            onClose();
          } catch {
            setError('Erreur réseau Google OAuth');
          } finally {
            setSubmitting(false);
          }
        },
      });
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: 300,
        text: 'signin_with',
      });
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
  }, [open, googleClientId, onClose, onSuccess]);

  if (!open) return null;

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { user?: AuthUser; error?: string };
      if (!res.ok || !data.user) {
        setError(data.error ?? 'Clé invalide');
        return;
      }
      setPassword('');
      onSuccess(data.user);
      onClose();
    } catch {
      setError('Erreur de connexion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal modal-blur show d-block"
      style={{ backgroundColor: 'rgba(10, 15, 25, 0.72)', zIndex: 1050 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-dialog modal-sm modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title d-flex align-items-center gap-2">
              <Lock size={16} className="text-primary" />
              {t('loginModalTitle')}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close">
              <X size={16} className="d-none" />
            </button>
          </div>

          <div className="modal-body">
            <p className="text-secondary small mb-3">{t('loginModalSubtitle')}</p>

            {error && <div className="alert alert-danger py-2 small">{error}</div>}

            {googleClientId && (
              <div className="mb-3">
                <div ref={googleBtnRef} className="d-flex justify-content-center" />
                <div className="hr-text my-3">ou</div>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <div className="mb-3">
                <label className="form-label small d-flex align-items-center gap-1">
                  <KeyRound size={13} />
                  {t('loginPasswordLabel')}
                </label>
                <input
                  type="password"
                  className="form-control font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary w-100"
                disabled={submitting || !password}
              >
                {submitting ? '...' : t('loginSubmit')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
