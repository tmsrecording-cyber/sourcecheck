import { Check, Minus, X } from 'lucide-react';
import type { VerificationStatus } from '../../../shared/types';

interface VerdictBadgeProps {
  status: VerificationStatus;
}

const VERDICT_META: Record<
  VerificationStatus,
  {
    label: string;
    className: string;
    icon: typeof Check;
  }
> = {
  supported: {
    label: 'Supported',
    className: 'verdict-badge-supported',
    icon: Check,
  },
  partial: {
    label: 'Mixed',
    className: 'verdict-badge-partial',
    icon: Minus,
  },
  disputed: {
    label: 'Unsupported',
    className: 'verdict-badge-disputed',
    icon: X,
  },
  unverifiable: {
    label: 'Unresolved',
    className: 'verdict-badge-unverifiable',
    icon: Minus,
  },
};

export const VerdictBadge = ({ status }: VerdictBadgeProps) => {
  const verdictMeta = VERDICT_META[status];
  const Icon = verdictMeta.icon;

  return (
    <span className={`verdict-badge ${verdictMeta.className}`}>
      <span className="verdict-badge-mark" aria-hidden="true">
        <Icon size={10} strokeWidth={2.5} />
      </span>
      <span>{verdictMeta.label}</span>
    </span>
  );
};
