import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cloneElement, isValidElement, useId, type ReactNode, type ReactElement } from 'react';
import type { MascotKind } from './types';

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
export function Mascot({
  kind = 'star',
  size = 48,
  className = '',
}: {
  kind?: MascotKind;
  size?: number;
  className?: string;
}) {
  const fill =
    kind === 'bunny'
      ? '#f4d8cf'
      : kind === 'cloud'
        ? '#d9e6f5'
        : kind === 'moon'
          ? '#e5def6'
          : '#f7e5b1';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      className={`mascot ${className}`}
      aria-hidden="true"
    >
      <ellipse cx="40" cy="72" rx="20" ry="3" fill="#59516f" opacity=".08" />
      <g className="mascot-body">
        {kind === 'bunny' ? (
          <path
            d="M24 35C14 7 31 2 34 31h8C45 2 63 9 53 35c15 7 14 31-13 31S9 43 24 35Z"
            fill={fill}
          />
        ) : kind === 'cloud' ? (
          <path d="M17 61C1 54 5 35 21 33 19 10 53 9 56 31c24-1 29 32 7 34H23Z" fill={fill} />
        ) : kind === 'moon' ? (
          <path d="M54 15c-18 7-16 33 8 34-9 26-44 21-48-2C10 26 32 7 54 15Z" fill={fill} />
        ) : (
          <path d="m40 9 10 17 20 3-13 16 3 21-20-9-19 9 2-21L9 29l21-3Z" fill={fill} />
        )}
        <path
          d={kind === 'moon' ? 'M23 39v4m16-4v4' : 'M31 40v4m17-4v4'}
          stroke="#625675"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d={kind === 'moon' ? 'M27 50q4 4 8 0' : 'M35 51q5 4 10-1'}
          stroke="#625675"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d="m28 65-2 5m25-5 2 5" stroke="#9384a4" strokeWidth="2.5" strokeLinecap="round" />
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
