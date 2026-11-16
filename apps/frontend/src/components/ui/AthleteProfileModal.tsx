import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Flame, KeyRound, Loader2, MonitorSmartphone, Nfc, Save, ShieldCheck, Target, Trash2, Trophy, User, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/api/client'
import { useAuth } from '@/store'
import { toasts } from '@/components/ui/ToastProvider'
import { WrappedModal } from '@/components/ui/WrappedModal'
import { hapticSuccess, hapticTap } from '@/lib/haptics'
import type { AthleteGoal, AthleteProfile, AuthMode, NutritionToday, TrustedDevice, UpcomingWorkouts, WeighIn } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — AthleteProfileModal
//
// Deux onglets :
//   1. Nutrition & Stats  — jauges du jour, biométrie éditable, pesées récentes
//   2. Sécurité & NFC     — identifiant, mode d'authentification, badge NFC
//
// Les cibles sont recalculées côté serveur (Mifflin-St Jeor × activité) à
// chaque enregistrement : aucun calcul de formule dans l'UI.
// ─────────────────────────────────────────────────────────────────────────────

const GOALS: Array<{ value: AthleteGoal; label: string; hint: string }> = [
  { value: 'MAINTAIN', label: 'Maintien', hint: '±0 kcal' },
  { value: 'BULK', label: 'Prise de masse', hint: '+300 kcal' },
  { value: 'CUT', label: 'Sèche', hint: '−400 kcal' },
  { value: 'CARB_LOAD', label: 'Charge glucidique', hint: '+450 kcal' },
]

const ACTIVITY_STEPS: Array<{ value: number; label: string }> = [
  { value: 1.2, label: 'Sédentaire' },
  { value: 1.375, label: 'Léger' },
  { value: 1.55, label: 'Modéré' },
  { value: 1.725, label: 'Actif' },
  { value: 1.9, label: 'Très actif' },
]

const AUTH_MODES: Array<{ value: AuthMode; label: string; hint: string }> = [
  { value: 'AUTO_DEVICE', label: 'Appareil de confiance', hint: 'Sélection = session' },
  { value: 'PIN_ONLY', label: 'Code PIN', hint: '4 chiffres' },
  { value: 'USERNAME_PIN', label: 'Identifiant + PIN', hint: 'Le plus strict' },
]

function activityLabel(value: number): string {
  return ACTIVITY_STEPS.reduce((acc, step) =>
    Math.abs(step.value - value) < Math.abs(acc.value - value) ? step : acc,
  ).label
}

function MacroBar({
  label,
  consumed,
  target,
  color,
}: {
  label: string
  consumed: number
  target: number
  color: string
}) {
  const ratio = target > 0 ? Math.min(1, consumed / target) : 0
  const remaining = Math.round(target - consumed)

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="label-micro">{label}</span>
        <span className="font-mono text-2xs tabular-nums text-text-secondary">
          {Math.round(consumed)} / {target}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-ios"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
      </div>
      <div className="mt-1 font-mono text-[9px] text-slate-500 tabular-nums">
        {remaining >= 0 ? `${remaining} restants` : `${Math.abs(remaining)} au-dessus`}
      </div>
    </div>
  )
}

export interface AthleteProfileModalProps {
  open: boolean
  onClose: () => void
}

export function AthleteProfileModal({ open, onClose }: AthleteProfileModalProps) {
  const user = useAuth((s) => s.user)
  const token = useAuth((s) => s.token)
  const refreshToken = useAuth((s) => s.refreshToken)
  const setAuth = useAuth((s) => s.setAuth)

  const [tab, setTab] = useState<'nutrition' | 'security'>('nutrition')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [profile, setProfile] = useState<AthleteProfile | null>(null)
  const [today, setToday] = useState<NutritionToday | null>(null)
  const [weighIns, setWeighIns] = useState<WeighIn[]>([])
  const [upcoming, setUpcoming] = useState<UpcomingWorkouts | null>(null)
  const [wrappedOpen, setWrappedOpen] = useState(false)

  // Formulaire biométrique
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState<'M' | 'F'>('M')
  const [activityFactor, setActivityFactor] = useState(1.55)
  const [goal, setGoal] = useState<AthleteGoal>('MAINTAIN')

  // Sécurité
  const [username, setUsername] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('AUTO_DEVICE')
  const [nfcUrl, setNfcUrl] = useState<string | null>(null)
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null)
  const [securitySaving, setSecuritySaving] = useState(false)

  const applyProfile = useCallback((next: AthleteProfile) => {
    setProfile(next)
    setWeight(String(next.weightKg))
    setHeight(String(next.heightCm))
    setBirthDate(next.birthDate)
    setSex(next.sex)
    setActivityFactor(next.activityFactor)
    setGoal(next.goal)
  }, [])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const [fresh, todayData, history, next] = await Promise.all([
          api.getAthleteProfile(),
          api.getNutritionToday().catch(() => null),
          api.getWeighIns(8).catch(() => [] as WeighIn[]),
          api.getUpcomingWorkouts().catch(() => null),
        ])
        if (cancelled) return

        if (fresh) {
          applyProfile(fresh)
        } else if (user) {
          // Premier passage : on pré-remplit avec des valeurs neutres
          setWeight('')
          setHeight('')
          setBirthDate('')
        }

        setToday(todayData)
        setWeighIns(history)
        setUpcoming(next)
      } catch (err) {
        if (!cancelled) {
          toasts.error('Profil indisponible', err instanceof Error ? err.message : undefined)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, applyProfile, user])

  useEffect(() => {
    setUsername(user?.username ?? '')
    setAuthMode((user?.authMode as AuthMode) ?? 'AUTO_DEVICE')
  }, [user?.username, user?.authMode, open])

  // Appareils de confiance : chargés à l'ouverture de l'onglet Sécurité
  useEffect(() => {
    if (!open || tab !== 'security') return
    let cancelled = false
    api
      .listDevices()
      .then((list) => {
        if (!cancelled) setDevices(list)
      })
      .catch(() => {
        if (!cancelled) setDevices([])
      })
    return () => {
      cancelled = true
    }
  }, [open, tab])

  const handleRevokeDevice = async (device: TrustedDevice) => {
    try {
      await api.revokeDevice(device.id)
      setDevices((current) => (current ?? []).filter((item) => item.id !== device.id))
      hapticSuccess()
      toasts.info(
        'Appareil révoqué',
        device.isCurrent
          ? 'Ton code PIN ne fonctionnera plus ici sans mot de passe.'
          : device.label,
      )
    } catch (err) {
      toasts.error('Révocation impossible', err instanceof Error ? err.message : undefined)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSaveProfile = async () => {
    if (saving) return

    const weightKg = Number(weight)
    const heightCm = Number(height)

    if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !birthDate) {
      toasts.error('Champs manquants', 'Poids, taille et date de naissance sont requis.')
      return
    }

    setSaving(true)
    try {
      const saved = await api.saveAthleteProfile({
        weightKg,
        heightCm,
        birthDate,
        sex,
        activityFactor,
        goal,
      })
      applyProfile(saved)
      setToday(await api.getNutritionToday().catch(() => today))
      hapticSuccess()
      toasts.info('Profil enregistré', `${saved.targetKcal} kcal · ${saved.targetProtein} g protéines`)
    } catch (err) {
      toasts.error('Enregistrement impossible', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSecurity = async () => {
    if (securitySaving) return
    setSecuritySaving(true)

    try {
      const updated = await api.updateSecurity({
        username: username.trim() === '' ? null : username.trim().toLowerCase(),
        authMode,
      })
      if (token && refreshToken) setAuth(token, refreshToken, updated)
      hapticSuccess()
      toasts.info('Sécurité mise à jour', authMode === 'AUTO_DEVICE' ? 'Accès direct' : 'Protection active')
    } catch (err) {
      toasts.error('Mise à jour impossible', err instanceof Error ? err.message : undefined)
    } finally {
      setSecuritySaving(false)
    }
  }

  const handleRegenerateNfc = async () => {
    try {
      const badge = await api.regenerateNfcBadge()
      setNfcUrl(badge.url)
      hapticSuccess()
    } catch (err) {
      toasts.error('Génération impossible', err instanceof Error ? err.message : undefined)
    }
  }

  const handleCopyNfc = async () => {
    if (!nfcUrl) return
    try {
      await navigator.clipboard.writeText(nfcUrl)
      hapticTap()
      toasts.info('URL copiée', 'Colle-la dans un raccourci NFC iOS')
    } catch {
      toasts.error('Copie impossible', 'Sélectionne le texte manuellement.')
    }
  }

  const recent = useMemo(() => weighIns.slice(0, 5), [weighIns])

  if (!open) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="athlete-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="athlete-sheet"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="fixed inset-x-0 bottom-0 z-[121] md:inset-0 md:m-auto md:h-fit md:max-w-md"
        role="dialog"
        aria-label="Profil athlète"
      >
        <div className="glass-sheet rounded-t-[28px] md:rounded-[24px] max-h-[88vh] overflow-y-auto px-4 pb-6 pt-3 font-sans">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 md:hidden" />

          <div className="flex items-center gap-2 mb-3">
            <User size={15} className="text-accent" />
            <span className="label-micro">Profil{user ? ` — ${user.name}` : ''}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le profil"
              className="ml-auto w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-white"
            >
              <X size={14} />
            </button>
          </div>

          {/* Onglets */}
          <div className="flex p-0.5 rounded-xl border border-white/10 bg-black/25 mb-3">
            {([
              { id: 'nutrition', label: 'Nutrition & Stats', icon: Flame },
              { id: 'security', label: 'Sécurité & NFC', icon: ShieldCheck },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  hapticTap()
                  setTab(id)
                }}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg font-sans text-[11px] tap transition-colors',
                  tab === id ? 'bg-white/10 text-white' : 'text-slate-400',
                )}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              <span className="font-mono text-2xs">CHARGEMENT…</span>
            </div>
          )}

          {!loading && tab === 'nutrition' && (
            <>
              {/* Jauges du jour */}
              <div className="grid grid-cols-2 gap-1.5">
                <MacroBar
                  label="CALORIES"
                  consumed={today?.consumed.kcal ?? 0}
                  target={today?.effective?.kcal ?? today?.targets?.kcal ?? profile?.targetKcal ?? 0}
                  color="#f59e0b"
                />
                <MacroBar
                  label="PROTÉINES"
                  consumed={today?.consumed.proteinG ?? 0}
                  target={today?.effective?.proteinG ?? today?.targets?.proteinG ?? profile?.targetProtein ?? 0}
                  color="#38bdf8"
                />
                <MacroBar
                  label="GLUCIDES"
                  consumed={today?.consumed.carbsG ?? 0}
                  target={today?.effective?.carbsG ?? today?.targets?.carbsG ?? profile?.targetCarbs ?? 0}
                  color="#a78bfa"
                />
                <MacroBar
                  label="LIPIDES"
                  consumed={today?.consumed.fatG ?? 0}
                  target={today?.effective?.fatG ?? today?.targets?.fatG ?? profile?.targetFat ?? 0}
                  color="#f472b6"
                />
              </div>

              {(today?.workoutBonus?.kcal ?? 0) > 0 && (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2">
                  <span className="flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-wider text-emerald-300">
                    <Flame size={11} />
                    Séance du jour
                  </span>
                  <span className="font-mono text-[11px] text-emerald-300 tabular-nums">
                    +{today?.workoutBonus?.kcal} kcal
                  </span>
                </div>
              )}

              {upcoming?.carbLoadRecommended && (
                <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Target size={11} className="text-amber-300" />
                    <span className="font-sans text-[10px] uppercase tracking-wider text-amber-300">
                      Recharge glucidique conseillée
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-amber-200/70">
                    {upcoming.workouts.map((w) => `${w.sportType} ${w.durationMin} min`).join(' · ') ||
                      'Séance demain'}
                  </p>
                </div>
              )}

              {profile && (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 font-mono text-[10px] text-slate-400 tabular-nums">
                  <span>BMR {profile.bmr} kcal</span>
                  <span>TDEE {profile.tdee} kcal</span>
                  <span>{profile.age} ans</span>
                </div>
              )}

              {/* Biométrie */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="flex flex-col gap-1">
                  <span className="label-micro">Poids (kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.1}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="72"
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/60"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label-micro">Taille (cm)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="178"
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/60"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="flex flex-col gap-1">
                  <span className="label-micro">Naissance</span>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/60"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="label-micro">Sexe</span>
                  <div className="flex gap-1">
                    {(['M', 'F'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSex(value)}
                        className={clsx(
                          'flex-1 py-2 rounded-xl border text-xs font-medium tap ease-ios transition-all',
                          sex === value
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-white/10 text-slate-400 hover:text-slate-200',
                        )}
                      >
                        {value === 'M' ? 'Homme' : 'Femme'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Activité */}
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="label-micro">Niveau d'activité</span>
                  <span className="font-mono text-2xs text-text-secondary tabular-nums">
                    {activityLabel(activityFactor)} · {activityFactor.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.2}
                  max={1.9}
                  step={0.025}
                  value={activityFactor}
                  onChange={(e) => setActivityFactor(Number(e.target.value))}
                  className="w-full mt-2 accent-[#4fc3f7]"
                  aria-label="Niveau d'activité"
                />
              </div>

              {/* Objectif */}
              <div className="mt-4">
                <span className="label-micro">Objectif</span>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  {GOALS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setGoal(option.value)}
                      className={clsx(
                        'rounded-xl border px-2.5 py-2 text-left tap ease-ios transition-all',
                        goal === option.value
                          ? 'border-accent/40 bg-accent/10'
                          : 'border-white/10 hover:border-white/20',
                      )}
                    >
                      <div className={clsx('font-sans text-[11px]', goal === option.value ? 'text-accent' : 'text-slate-300')}>
                        {option.label}
                      </div>
                      <div className="font-mono text-[9px] text-slate-500">{option.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleSaveProfile()}
                disabled={saving}
                className="mt-4 w-full h-11 rounded-2xl border border-accent/40 bg-accent/15 text-accent font-sans text-[11px] tracking-[0.18em] uppercase flex items-center justify-center gap-2 tap hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Enregistrement…' : 'Enregistrer & recalculer'}
              </button>

              {/* Accès au recap hebdomadaire */}
              <button
                type="button"
                onClick={() => {
                  hapticTap()
                  setWrappedOpen(true)
                }}
                className="mt-3 w-full h-10 rounded-2xl border border-amber-400/35 bg-amber-400/10 text-amber-300 font-sans text-[11px] tracking-[0.16em] uppercase flex items-center justify-center gap-2 tap hover:bg-amber-400/20 transition-colors"
              >
                <Trophy size={13} />
                Voir mon Wrapped
              </button>

              {/* Pesées */}
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-1.5">
                  <Activity size={12} className="text-slate-400" />
                  <span className="label-micro">Dernières pesées</span>
                </div>
                {recent.length === 0 ? (
                  <p className="font-sans text-[11px] text-slate-500">
                    Aucune pesée enregistrée — la balance synchronisée alimentera cette liste.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {recent.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px] tabular-nums"
                      >
                        <span className="text-slate-400">
                          {new Date(entry.measuredAt).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </span>
                        <span className="text-text-primary">{entry.weightKg.toFixed(1)} kg</span>
                        <span className="text-slate-500">
                          {entry.bodyFatPct !== null ? `${entry.bodyFatPct.toFixed(1)} % MG` : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {!loading && tab === 'security' && (
            <>
              <label className="flex flex-col gap-1">
                <span className="label-micro">Identifiant de connexion</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="matteo"
                  autoCapitalize="none"
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary focus:outline-none focus:border-accent/60"
                />
              </label>

              <div className="mt-4">
                <span className="label-micro">Mode d'authentification</span>
                <div className="space-y-1.5 mt-1.5">
                  {AUTH_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setAuthMode(mode.value)}
                      className={clsx(
                        'w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left tap ease-ios transition-all',
                        authMode === mode.value
                          ? 'border-accent/40 bg-accent/10'
                          : 'border-white/10 hover:border-white/20',
                      )}
                    >
                      <KeyRound size={12} className={authMode === mode.value ? 'text-accent' : 'text-slate-500'} />
                      <span className="flex-1">
                        <span
                          className={clsx(
                            'block font-sans text-[11px]',
                            authMode === mode.value ? 'text-accent' : 'text-slate-300',
                          )}
                        >
                          {mode.label}
                        </span>
                        <span className="block font-mono text-[9px] text-slate-500">{mode.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleSaveSecurity()}
                disabled={securitySaving}
                className="mt-3 w-full h-10 rounded-2xl border border-white/15 bg-white/[0.06] text-text-primary font-sans text-[11px] tracking-[0.18em] uppercase flex items-center justify-center gap-2 tap hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {securitySaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Appliquer
              </button>

              {/* Badge NFC */}
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <Nfc size={13} className="text-accent" />
                  <span className="label-micro">Badge NFC iPhone</span>
                </div>
                <p className="mt-1.5 font-sans text-[11px] leading-snug text-slate-400">
                  Génère un lien magique, colle-le dans un raccourci iOS, puis approche l'iPhone de
                  la puce NFC : la session s'ouvre sans PIN.
                </p>

                <button
                  type="button"
                  onClick={() => void handleRegenerateNfc()}
                  className="mt-2.5 w-full h-10 rounded-xl border border-accent/40 bg-accent/15 text-accent font-sans text-[11px] tracking-[0.16em] uppercase flex items-center justify-center gap-2 tap hover:bg-accent/25 transition-colors"
                >
                  <Nfc size={13} />
                  Générer / régénérer
                </button>

                {nfcUrl && (
                  <div className="mt-2 space-y-1.5">
                    <code className="block break-all rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[9px] text-slate-300">
                      {nfcUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyNfc()}
                      className="w-full h-8 rounded-lg border border-white/10 font-mono text-[10px] text-slate-300 tap hover:border-white/25"
                    >
                      COPIER L'URL
                    </button>
                    <p className="font-mono text-[9px] text-slate-500">
                      Régénérer invalide immédiatement l'ancien badge.
                    </p>
                  </div>
                )}
              </div>

              {/* Appareils de confiance */}
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <MonitorSmartphone size={13} className="text-accent" />
                  <span className="label-micro">Appareils enregistrés</span>
                </div>
                <p className="mt-1.5 font-sans text-[11px] leading-snug text-slate-400">
                  Ton code PIN ne fonctionne que sur ces appareils. Révoque un téléphone perdu :
                  il faudra repasser par ton mot de passe dessus.
                </p>

                {devices === null ? (
                  <div className="mt-2.5 flex items-center gap-2 text-slate-500">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="font-mono text-[10px]">Chargement…</span>
                  </div>
                ) : devices.length === 0 ? (
                  <p className="mt-2.5 font-mono text-[10px] text-slate-500">Aucun appareil enregistré.</p>
                ) : (
                  <ul className="mt-2.5 space-y-1.5">
                    {devices.map((device) => (
                      <li
                        key={device.id}
                        className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-2.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-sans text-[11px] text-slate-200">{device.label}</span>
                            {device.isCurrent && (
                              <span className="rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-accent">
                                Cet appareil
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[9px] text-slate-500">
                            Utilisé le {new Date(device.lastUsedAt).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRevokeDevice(device)}
                          aria-label={`Révoquer ${device.label}`}
                          className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-red-300 hover:border-red-400/40"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                <Target size={12} className="text-slate-500" />
                <span className="font-sans text-[10px] text-slate-400">
                  Changer de colocataire reste possible depuis l'icône de profil du HUD.
                </span>
              </div>
            </>
          )}
        </div>
      </motion.div>
      <WrappedModal open={wrappedOpen} onClose={() => setWrappedOpen(false)} />
    </AnimatePresence>,
    document.body,
  )
}
