import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cloneElement, isValidElement, useId, type ReactNode, type ReactElement } from 'react';
import type { MascotKind } from './types';
import type { FoxSkin } from './groveTypes';

export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${wide ? 'wide' : ''}`}
          onOpenAutoFocus={(event) => {
            if (matchMedia('(max-width: 600px)').matches) event.preventDefault();
          }}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭弹窗">
              <X size={22} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="muted modal-description">
            {description || '在这里编辑并保存你的安排。'}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export const mascotNames: Record<MascotKind, string> = {
  star: '火把小狐狸',
  cloud: '火把小狗',
  moon: '火把小猫',
  bunny: '火把小兔',
};

// Original pixel drawings. Existing mascot IDs keep old tasks and backups compatible.
export function Mascot({
  kind = 'star',
  size = 48,
  className = '',
  skin = 'ember',
}: {
  kind?: MascotKind;
  size?: number;
  className?: string;
  skin?: FoxSkin;
}) {
  const fox = kind === 'star',
    dog = kind === 'cloud',
    rabbit = kind === 'bunny';
  const foxPalette = {
    ember: ['#ee873d', '#ffb45a'],
    snow: ['#dce8f1', '#ffffff'],
    dusk: ['#9a87d4', '#cab8f5'],
    sun: ['#d99a2e', '#ffdc7b'],
  }[skin];
  const fur = fox ? foxPalette[0] : dog ? '#c79b68' : rabbit ? '#e1dce4' : '#859ac8';
  const light = fox ? foxPalette[1] : dog ? '#e9c595' : rabbit ? '#fff2dc' : '#bccbe5';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 88"
      fill="none"
      shapeRendering="crispEdges"
      className={`mascot pixel-mascot ${className}`}
      aria-hidden="true"
    >
      <ellipse cx="42" cy="80" rx="29" ry="4" fill="#000" opacity=".3" />
      <g className="mascot-body">
        <path d="M24 48H56V72H60V80H44V72H36V80H20V72H24Z" fill={fur} />
        <path d="M32 52H48V68H32Z" fill={light} />
        {fox && <path d="M24 60H12V56H4V68H8V76H24Z" fill={fur} />}
        {fox && <path d="M4 56H12V68H4Z" fill="#ffe6bc" />}
        {rabbit ? (
          <>
            <path d="M24 28V4H36V28H44V4H56V36H20V28Z" fill={fur} />
            <path d="M28 8H32V28H28ZM48 8H52V28H48Z" fill="#dc9a9b" />
          </>
        ) : dog ? (
          <>
            <path d="M16 20H28V52H16ZM52 20H64V52H52Z" fill="#815a3b" />
          </>
        ) : (
          <>
            <path d="M20 32V12H28V16H32V24H48V16H52V12H60V36Z" fill={fur} />
            <path d="M24 20H28V28H24ZM52 20H56V28H52Z" fill="#e8aa94" />
          </>
        )}
        <path d="M24 24H56V28H60V48H56V56H24V52H20V32H24Z" fill={fur} />
        <path d="M24 40H32V44H48V40H56V52H48V56H32V52H24Z" fill="#fff0d1" />
        <path d="M28 32H32V40H28ZM48 32H52V40H48Z" fill="#101a2e" />
        <path d="M36 44H44V48H36ZM40 48H44V52H40Z" fill="#423044" />
        <path d="M24 28H32V32H24Z" fill={light} />
        <path d="M56 52H68V60H56Z" fill={fur} />
        <g className="pixel-torch">
          <path d="M68 36H76V68H68Z" fill="#7c472d" />
          <path d="M68 36H72V64H68Z" fill="#d5a05a" />
          <path d="M64 32H80V40H64Z" fill="#ffcc67" />
          <g className="torch-flame">
            <path d="M64 28V16H68V8H72V4H76V16H80V24H84V32H80V36H64V32H60V28Z" fill="#f45b37" />
            <path d="M68 28V20H72V12H76V24H80V32H76V36H68Z" fill="#ffb83f" />
            <path d="M68 28H72V24H76V36H68Z" fill="#fff1a1" />
          </g>
          <rect className="torch-spark" x="80" y="6" width="4" height="4" fill="#ffd972" />
        </g>
      </g>
    </svg>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    ['input', 'select', 'textarea'].includes(children.type)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          ...(!(children.props as Record<string, unknown>)['aria-label']
            ? { 'aria-labelledby': `${id}-label` }
            : {}),
          ...(hint ? { 'aria-describedby': `${id}-hint` } : {}),
        })
      : children;
  return (
    <label className="field">
      <span id={`${id}-label`}>{label}</span>
      {control}
      {hint && (
        <small className="muted" id={`${id}-hint`}>
          {hint}
        </small>
      )}
    </label>
  );
}
