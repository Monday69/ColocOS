import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Delete, KeyRound, Loader2, Lock, Mail, User, UserPlus } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/api/client'
import { useAuth } from '@/store'
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics'
import type { RoommateProfile } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — ProfilePickerModal (« Qui cuisine aujourd'hui ? »)
//
// Écran d'accueil d'une tablette partagée :
//   1. mosaïque des colocataires (initiale + prénom + couleur néon) ;
//   2. pavé PIN 4 chiffres (4 cercles, clavier numérique, auto-submit) ;
//   3. premier accès (hasPin === false) → création du code + email optionnel.
//
// Aucune donnée sensible n'est exposée par `GET /auth/profiles` (ni email ni
// hash) : seule la présence d'un PIN (`hasPin`) est publique.
// ─────────────────────────────────────────────────────────────────────────────

const PIN_LENGTH = 4
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

type Step = 'pick' | 'pin' | 'setup' | 'confirm'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

/**
 * Repli défensif : une couleur invalide en base (ex. seed `#YU8544`) casserait
 * le dégradé CSS et rendrait l'avatar invisible.
 */
function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#6366F1'
}

/** Cercles du code PIN (remplis au fil de la saisie). */
function PinDots({ value, error }: { value: string; error: boolean }) {
  return (
    <motion.div
      className="flex items-center justify-center gap-3 py-2"
      animate={error ? { x: [0, -10, 10, -8, 8, 0] } : { x: 0 }}
      transition={{ duration: 0.42 }}
    >
      {Array.from({ length: PIN_LENGTH }).map((_, index) => {
        const filled = index < value.length
        return (
          <span
            key={index}
            className={clsx(
              'w-3.5 h-3.5 rounded-full border transition-all duration-150',
              error
                ? 'border-red-400/70 bg-red-400/60'
                : filled
                  ? 'border-accent bg-accent scale-110'
                  : 'border-white/25 bg-white/5',
            )}
          />
        )
      })}
    </motion.div>
  )
}

export interface ProfilePickerProps {
  /** Appelé après un login réussi (le store auth est déjà hydraté) */
  onAuthenticated?: () => void
  /** Lien de repli vers la connexion email/mot de passe */
  onUsePassword?: () => void
}

export function ProfilePicker({ onAuthenticated, onUsePassword }: ProfilePickerProps) {
  const setAuth = useAuth((state) => state.setAuth)

  const [profiles, setProfiles] = useState<RoommateProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [step, setStep] = useState<Step>('pick')
  const [selected, setSelected] = useState<RoommateProfile | null>(null)
  const [pin, setPin] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [email, setEmail] = useState('')
  // Mode `USERNAME_PIN` : identifiant saisi avant le code
  const [usernameInput, setUsernameInput] = useState('')
  const [error, setError] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setProfiles(await api.getProfiles())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Profils indisponibles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  const resetToPicker = () => {
    setStep('pick')
    setSelected(null)
    setPin('')
    setFirstPin('')
    setEmail('')
    setError(false)
    setMessage(null)
    hapticTap()
  }

  const finishAuthentication = (result: { user: Parameters<typeof setAuth>[2]; tokens: { accessToken: string; refreshToken: string } }) => {
    setAuth(result.tokens.accessToken, result.tokens.refreshToken, result.user)
    hapticSuccess()
    onAuthenticated?.()
  }

  const submitPin = useCallback(
    async (code: string) => {
      if (!selected || busy) return
      setBusy(true)
      setError(false)

      try {
        const result = await api.loginWithPin(selected.id, code, usernameInput.trim() || undefined)
        finishAuthentication(result)
      } catch (err) {
        hapticError()
        setError(true)
        setMessage(err instanceof Error ? err.message : 'Code PIN incorrect.')
        // Reset des 4 chiffres après la secousse
        window.setTimeout(() => {
          setPin('')
          setError(false)
        }, 450)
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, busy, usernameInput],
  )

  const submitSetup = useCallback(
    async (code: string) => {
      if (!selected || busy) return
      setBusy(true)
      setError(false)

      try {
        const result = await api.setupPin(selected.id, code, email.trim() || undefined)
        finishAuthentication(result)
      } catch (err) {
        hapticError()
        setError(true)
        setMessage(err instanceof Error ? err.message : 'Impossible d’enregistrer le code.')
        window.setTimeout(() => {
          setPin('')
          setFirstPin('')
          setStep('setup')
          setError(false)
        }, 450)
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, busy, email],
  )

  const handleDigit = (digit: string) => {
    if (busy || error) return
    hapticTap()
    setMessage(null)

    const next = (pin + digit).slice(0, PIN_LENGTH)
    setPin(next)

    if (next.length < PIN_LENGTH) return

    if (step === 'pin') {
      void submitPin(next)
      return
    }

    if (step === 'setup') {
      // Première saisie : on demande confirmation pour éviter un code fautif
      setFirstPin(next)
      setPin('')
      setStep('confirm')
      return
    }

    if (step === 'confirm') {
      if (next === firstPin) {
        void submitSetup(next)
      } else {
        hapticError()
        setError(true)
        setMessage('Les deux codes ne correspondent pas.')
        window.setTimeout(() => {
          setPin('')
          setFirstPin('')
          setStep('setup')
          setError(false)
        }, 450)
      }
    }
  }

  const handleBackspace = () => {
    if (busy) return
    setPin((current) => current.slice(0, -1))
  }

  // ── Mosaïque des profils ───────────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <div className="w-full">
        <h2 className="font-display text-xl font-600 tracking-wide text-text-primary text-center">
          Qui cuisine aujourd’hui ?
        </h2>
        <p className="font-body text-xs text-text-tertiary text-center mt-1">
          Choisis ton profil pour ouvrir la cuisine.
        </p>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="font-mono text-2xs">CHARGEMENT DES PROFILS…</span>
          </div>
        )}

        {loadError && (
          <div className="mt-6 rounded-xl border border-red-400/30 bg-red-400/5 px-3 py-3 text-center">
            <p className="font-body text-xs text-red-300">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadProfiles()}
              className="mt-2 font-mono text-2xs text-accent hover:text-accent-bright"
            >
              RÉESSAYER
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <div className="grid grid-cols-3 gap-3 mt-6">
            {profiles.map((profile, index) => (
              <motion.button
                key={profile.id}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04, type: 'spring', stiffness: 380, damping: 28 }}
                onClick={() => {
                  hapticTap()
                  setSelected(profile)
                  setPin('')
                  setFirstPin('')
                  setEmail('')
                  setUsernameInput('')
                  setMessage(null)

                  // `AUTO_DEVICE` : la tablette de cuisine ouvre la session
                  // sans code. Les autres modes demandent leur secret.
                  if (profile.authMode === 'AUTO_DEVICE') {
                    setBusy(true)
                    void api
                      .loginWithDevice(profile.id)
                      .then((result) => finishAuthentication(result))
                      .catch((err) => {
                        hapticError()
                        setMessage(err instanceof Error ? err.message : 'Connexion impossible.')
                        setStep('pin')
                      })
                      .finally(() => setBusy(false))
                    return
                  }

                  setStep(profile.hasPin ? 'pin' : 'setup')
                }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03]
                           px-2 py-4 tap ease-ios hover:border-white/25 transition-all"
                style={{ boxShadow: `0 0 22px ${safeColor(profile.colorHex)}12` }}
              >
                <span
                  className="w-14 h-14 rounded-2xl flex items-center justify-center font-display text-lg font-600 text-white"
                  style={{
                    background: `linear-gradient(160deg, ${safeColor(profile.colorHex)}, ${safeColor(profile.colorHex)}66)`,
                    boxShadow: `0 0 18px ${safeColor(profile.colorHex)}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
                  }}
                >
                  {initials(profile.name)}
                </span>
                <span className="font-body text-[10px] text-slate-200 leading-tight text-center break-words">
                  <span className="block">{profile.name.split(' ')[0]}</span>
                  <span className="block text-slate-400">{profile.name.split(' ').slice(1).join(' ')}</span>
                </span>
                {profile.hasPin ? (
                  <Lock size={9} className="text-slate-500" />
                ) : (
                  <span className="font-mono text-[8px] text-health-warning">1er accès</span>
                )}
              </motion.button>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-center">
          {onUsePassword && (
            <button
              type="button"
              onClick={onUsePassword}
              className="font-mono text-2xs text-text-tertiary hover:text-accent transition-colors"
            >
              + Connexion par mot de passe
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Pavé PIN / création de code ────────────────────────────────────────────
  const isSetup = step === 'setup' || step === 'confirm'

  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={resetToPicker}
          aria-label="Revenir à la sélection de profil"
          className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-white"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0">
          <div className="font-body text-sm text-white truncate">{selected?.name}</div>
          <div className="font-mono text-[9px] text-slate-500 uppercase tracking-wider">
            {isSetup
              ? step === 'confirm'
                ? 'Confirme ton code'
                : 'Choisis un code à 4 chiffres'
              : 'Saisis ton code PIN'}
          </div>
        </div>
        {selected && (
          <span
            className="ml-auto w-9 h-9 rounded-xl flex items-center justify-center font-display text-xs text-white flex-shrink-0"
            style={{ background: `linear-gradient(160deg, ${safeColor(selected.colorHex)}, ${safeColor(selected.colorHex)}66)` }}
          >
            {initials(selected.name)}
          </span>
        )}
      </div>

      {/* Mode identifiant + PIN : l'identifiant est demandé avant le code */}
      {!isSetup && selected?.authMode === 'USERNAME_PIN' && (
        <label className="flex items-center gap-2 mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <User size={12} className="text-slate-500 flex-shrink-0" />
          <input
            type="text"
            value={usernameInput}
            onChange={(event) => setUsernameInput(event.target.value)}
            placeholder="Identifiant"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent font-body text-xs text-text-primary placeholder-text-tertiary focus:outline-none"
          />
        </label>
      )}

      <div className="mt-5">
        <PinDots value={pin} error={error} />
      </div>

      {message && (
        <p className={clsx('text-center font-body text-[11px] mt-1', error ? 'text-red-300' : 'text-slate-400')}>
          {message}
        </p>
      )}

      {isSetup && (
        <label className="flex items-center gap-2 mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <Mail size={12} className="text-slate-500 flex-shrink-0" />
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email (optionnel)"
            className="flex-1 bg-transparent font-body text-xs text-text-primary placeholder-text-tertiary focus:outline-none"
          />
        </label>
      )}

      <div className="grid grid-cols-3 gap-1.5 mt-4">
        {KEYPAD.map((key) => {
          if (key === 'clear') {
            return (
              <div key={key} className="h-11 flex items-center justify-center text-slate-600">
                <KeyRound size={12} />
              </div>
            )
          }

          if (key === 'back') {
            return (
              <button
                key={key}
                type="button"
                onClick={handleBackspace}
                aria-label="Effacer un chiffre"
                className="h-11 rounded-xl border border-white/10 text-slate-300 tap hover:border-white/25
                           flex items-center justify-center transition-all active:scale-95"
              >
                <Delete size={15} />
              </button>
            )
          }

          return (
            <button
              key={key}
              type="button"
              onClick={() => handleDigit(key)}
              disabled={busy}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.04] font-mono text-base
                         text-white tap hover:border-white/25 hover:bg-white/[0.07] transition-all
                         active:scale-95 disabled:opacity-50"
            >
              {key}
            </button>
          )
        })}
      </div>

      {busy && (
        <div className="flex items-center justify-center gap-2 mt-3 text-slate-400">
          <Loader2 size={12} className="animate-spin" />
          <span className="font-mono text-2xs">VÉRIFICATION…</span>
        </div>
      )}

      {isSetup && !busy && (
        <p className="mt-3 flex items-center justify-center gap-1 font-mono text-[9px] text-slate-500">
          <UserPlus size={9} /> Ton code protège ton profil sur la tablette partagée
        </p>
      )}
    </div>
  )
}

/** Conteneur plein écran (Liquid Glass) du sélecteur. */
export function ProfilePickerModal({ onUsePassword }: { onUsePassword?: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4">
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          className="w-full max-w-sm rounded-[26px] border border-white/10 bg-slate-900/70
                     backdrop-blur-2xl backdrop-saturate-150 px-4 py-5 shadow-glass-lg"
        >
          <ProfilePicker onUsePassword={onUsePassword} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
