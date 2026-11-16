/**
 * Refuse les codes PIN devinables en quelques essais : chiffres identiques
 * (0000), suites (1234, 9876) et années de naissance courantes (19xx / 20xx).
 */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return true;

  const digits = pin.split('').map(Number);
  if (digits.every((d) => d === digits[0])) return true;

  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;

  return /^(19|20)\d\d$/.test(pin);
}

export const WEAK_PIN_MESSAGE =
  'Code trop facile à deviner (0000, 1234, année…) : choisis-en un autre.';
